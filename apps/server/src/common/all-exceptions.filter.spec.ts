import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { MIGRATE_HINT } from '../prisma/prisma-errors.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

const BODY = { deviceId: '0192f100-0000-7000-8000-00000000000a', mutations: [{ op: 'card.upsert' }] };

function known(code: string, message = `Error ${code}`) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
}

function run(exception: unknown, options: { headersSent?: boolean } = {}) {
  const sent: { status?: number; body?: unknown; headers: Record<string, string>; ended: boolean } = {
    headers: {},
    ended: false,
  };
  const response = {
    headersSent: options.headersSent ?? false,
    setHeader(name: string, value: string) {
      sent.headers[name] = value;
    },
    status(code: number) {
      sent.status = code;
      return response;
    },
    json(body: unknown) {
      sent.body = body;
      return response;
    },
    end() {
      sent.ended = true;
    },
  };
  const request = { method: 'POST', originalUrl: '/api/sync/push', params: {}, query: {}, body: BODY };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return sent;
}

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_ERROR_PAYLOADS;
});

describe('AllExceptionsFilter', () => {
  it('keeps the status and body Nest gives an HTTP exception', () => {
    expect(run(new BadRequestException({ message: 'Validation failed', errors: [] }))).toMatchObject({
      status: 400,
      body: { message: 'Validation failed', errors: [] },
    });
    expect(run(new ConflictException('Conflict is already resolved'))).toMatchObject({
      status: 409,
      body: { statusCode: 409, message: 'Conflict is already resolved', error: 'Conflict' },
    });
    expect(run(new HttpException('Teapot', 418))).toMatchObject({ status: 418, body: { statusCode: 418, message: 'Teapot' } });
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('POST /api/sync/push → 400: Validation failed'));
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('does not log a refused unit token', () => {
    expect(run(new UnauthorizedException('Invalid unit token')).status).toBe(401);
    expect(warnLog).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('answers database errors with a status that says whether to fix the data or retry', () => {
    expect(run(known('P2003', 'Foreign key constraint violated on the constraint: `x`'))).toMatchObject({
      status: 400,
      body: { statusCode: 400, message: 'Invalid data: Foreign key constraint violated on the constraint: `x`', error: 'P2003' },
    });
    expect(run(known('P2002')).status).toBe(409);
    expect(run(known('P2025')).status).toBe(404);

    const busy = run(known('P2034', 'Transaction failed due to a write conflict or a deadlock'));
    expect(busy).toMatchObject({ status: 503, body: { statusCode: 503, error: 'P2034' }, headers: { 'Retry-After': '2' } });
    expect(errorLog).toHaveBeenCalledTimes(4);
  });

  it('logs schema drift with the fix', () => {
    expect(run(known('P2022', 'The column `InjurySite.siteCode` does not exist'))).toMatchObject({
      status: 500,
      body: { message: 'Database schema is out of date', error: 'P2022' },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(`hint: ${MIGRATE_HINT}`), expect.any(String));
  });

  it('logs an unexpected error with the request payload and the stack, and answers 500', () => {
    const error = new Error('boom');
    expect(run(error)).toMatchObject({ status: 500, body: { statusCode: 500, message: 'Internal server error' } });
    const [message, stack] = errorLog.mock.calls[0] as [string, string];
    expect(message).toContain('POST /api/sync/push → 500: Error: boom');
    expect(message).toContain(`body: ${JSON.stringify(BODY)}`);
    expect(stack).toBe(error.stack);
  });

  it('leaves the payload out when LOG_ERROR_PAYLOADS=false', () => {
    process.env.LOG_ERROR_PAYLOADS = 'false';
    run(new Error('boom'));
    expect(errorLog.mock.calls[0]?.[0]).not.toContain('body:');
  });

  it('keeps the status of an Express middleware error such as a 413', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true });
    expect(run(tooLarge)).toMatchObject({ status: 413, body: { statusCode: 413, message: 'request entity too large' } });
  });

  it('only ends a response that was already sent', () => {
    const sent = run(new Error('late'), { headersSent: true });
    expect(sent).toMatchObject({ ended: true });
    expect(sent.status).toBeUndefined();
  });
});
