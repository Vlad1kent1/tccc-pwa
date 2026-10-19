import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

const IS_PUBLIC = 'tccc:public';

/** Opts a handler or controller out of the unit token check. Only for routes that carry no casualty data. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Tokens shorter than this are refused at boot; a guessable token is no better than none. */
export const MIN_UNIT_TOKEN_LENGTH = 16;

export function configuredUnitToken(): string | null {
  return process.env.API_UNIT_TOKEN?.trim() || null;
}

export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match?.[1] ?? null;
}

/** Fixed-length digests, so the comparison takes the same time whatever the token length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Registered as the global guard: every route needs `Authorization: Bearer <API_UNIT_TOKEN>`
 * unless it is marked `@Public()`. With no token configured every guarded route answers 401,
 * so a misconfigured server fails closed.
 */
@Injectable()
export class UnitTokenGuard implements CanActivate {
  private readonly expected: Buffer | null;

  constructor(private readonly reflector: Reflector) {
    const token = configuredUnitToken();
    this.expected = token ? digest(token) : null;
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const token = bearerToken(http.getRequest<Request>().headers.authorization);
    if (this.expected && token && timingSafeEqual(digest(token), this.expected)) return true;

    http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer realm="tccc"');
    throw new UnauthorizedException(token ? 'Invalid unit token' : 'Unit token required');
  }
}
