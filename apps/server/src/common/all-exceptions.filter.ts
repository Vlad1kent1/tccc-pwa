import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  classifyDbError,
  dbErrorLines,
  describeDbError,
  isPrismaError,
  summarize,
  type DbErrorKind,
} from '../prisma/prisma-errors.js';
import { formatPayload, logError, payloadLoggingEnabled } from './error-log.js';

/** Seconds a client should wait before retrying a 503 caused by a transient database error. */
export const RETRY_AFTER_SECONDS = 2;

const STATUS_BY_KIND: Record<DbErrorKind, number> = {
  unique: HttpStatus.CONFLICT,
  'not-found': HttpStatus.NOT_FOUND,
  'invalid-data': HttpStatus.BAD_REQUEST,
  transient: HttpStatus.SERVICE_UNAVAILABLE,
  'schema-drift': HttpStatus.INTERNAL_SERVER_ERROR,
  unknown: HttpStatus.INTERNAL_SERVER_ERROR,
};

const MESSAGE_BY_KIND: Record<DbErrorKind, string> = {
  unique: 'Unique constraint failed',
  'not-found': 'Record not found',
  'invalid-data': 'Invalid data',
  transient: 'Database temporarily unavailable, retry later',
  'schema-drift': 'Database schema is out of date',
  unknown: 'Internal server error',
};

/** Client errors not worth a log line: a missing or wrong unit token, and an unknown id. */
const QUIET_STATUSES = new Set<number>([HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND]);

interface Reply {
  status: number;
  body: object;
}

/**
 * The only exception filter. HTTP exceptions keep the response Nest gives them. A database
 * error gets a status that says whether to fix the data (400, 404, 409) or to retry (503 with
 * Retry-After). Every database or unexpected error is logged with its code, stack trace, and
 * the request payload.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const reply = toReply(exception);
    this.log(exception, request, reply.status);

    if (response.headersSent) {
      response.end();
      return;
    }
    if (reply.status === HttpStatus.SERVICE_UNAVAILABLE) {
      response.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    }
    response.status(reply.status).json(reply.body);
  }

  private log(exception: unknown, request: Request, status: number): void {
    const line = `${request.method} ${request.originalUrl} → ${status}`;
    if (exception instanceof HttpException || middlewareStatus(exception) !== null) {
      if (status < 500 && QUIET_STATUSES.has(status)) return;
      const lines = [`${line}: ${(exception as Error).message}`];
      if (exception instanceof HttpException) lines.push(`response: ${formatPayload(exception.getResponse(), 2_000)}`);
      lines.push(...requestLines(request));
      if (status >= 500) logError(this.logger, lines, exception);
      else this.logger.warn(lines.join('\n  '));
      return;
    }
    const [headline, ...details] = dbErrorLines(describeDbError(exception));
    logError(this.logger, [`${line}: ${headline}`, ...details, ...requestLines(request)], exception);
  }
}

function toReply(exception: unknown): Reply {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'object' && response !== null) return { status, body: response };
    // The body Nest's own filter sends for a string response.
    const errorCode = (exception as { errorCode?: unknown }).errorCode;
    return { status, body: { statusCode: status, message: response, ...(errorCode !== undefined ? { errorCode } : {}) } };
  }
  const middleware = middlewareStatus(exception);
  if (middleware !== null) {
    return { status: middleware, body: { statusCode: middleware, message: (exception as Error).message } };
  }
  const kind = classifyDbError(exception);
  if (isPrismaError(exception) || kind !== 'unknown') {
    const status = STATUS_BY_KIND[kind];
    const message = kind === 'invalid-data' ? `Invalid data: ${summarize(exception)}` : MESSAGE_BY_KIND[kind];
    const code = describeDbError(exception).code;
    return { status, body: { statusCode: status, message, ...(code ? { error: code } : {}) } };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: MESSAGE_BY_KIND.unknown },
  };
}

/** Status of an `http-errors` error raised by Express middleware, such as body-parser's 413. */
function middlewareStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const { status, statusCode, expose } = error as Error & { status?: unknown; statusCode?: unknown; expose?: unknown };
  if (typeof expose !== 'boolean' || typeof statusCode !== 'number' || status !== statusCode) return null;
  return statusCode >= 400 && statusCode < 600 ? statusCode : null;
}

/** Route params, query, and body of the failed request. Headers, which carry the unit token, are left out. */
function requestLines(request: Request): string[] {
  const lines: string[] = [];
  if (hasKeys(request.params)) lines.push(`params: ${formatPayload(request.params)}`);
  if (hasKeys(request.query)) lines.push(`query: ${formatPayload(request.query)}`);
  if (payloadLoggingEnabled() && hasKeys(request.body)) lines.push(`body: ${formatPayload(request.body)}`);
  return lines;
}

function hasKeys(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}
