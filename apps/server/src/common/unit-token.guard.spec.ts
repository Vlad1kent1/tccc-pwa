import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken, UnitTokenGuard } from './unit-token.guard.js';

const TOKEN = 'unit-token-for-guard-spec-0001';

function contextFor(authorization: string | undefined, isPublic = false) {
  const setHeader = vi.fn();
  const handler = () => undefined;
  class Controller {}
  if (isPublic) Reflect.defineMetadata('tccc:public', true, Controller);
  const context = {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization === undefined ? {} : { authorization } }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

function guardWith(token: string | undefined): UnitTokenGuard {
  const previous = process.env.API_UNIT_TOKEN;
  if (token === undefined) delete process.env.API_UNIT_TOKEN;
  else process.env.API_UNIT_TOKEN = token;
  try {
    return new UnitTokenGuard(new Reflector());
  } finally {
    if (previous === undefined) delete process.env.API_UNIT_TOKEN;
    else process.env.API_UNIT_TOKEN = previous;
  }
}

describe('UnitTokenGuard', () => {
  it('lets a request with the configured bearer token through', () => {
    expect(guardWith(TOKEN).canActivate(contextFor(`Bearer ${TOKEN}`).context)).toBe(true);
    expect(guardWith(TOKEN).canActivate(contextFor(`bearer   ${TOKEN}`).context)).toBe(true);
  });

  it('answers 401 with a Bearer challenge for a missing, malformed, or wrong token', () => {
    const guard = guardWith(TOKEN);
    for (const header of [undefined, '', TOKEN, `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`]) {
      const { context, setHeader } = contextFor(header);
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer realm="tccc"');
    }
  });

  it('fails closed when no token is configured', () => {
    for (const configured of [undefined, '', '   ']) {
      const guard = guardWith(configured);
      expect(() => guard.canActivate(contextFor('Bearer ').context)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(contextFor('Bearer anything').context)).toThrow(UnauthorizedException);
    }
  });

  it('skips the check for routes marked public', () => {
    expect(guardWith(TOKEN).canActivate(contextFor(undefined, true).context)).toBe(true);
    expect(guardWith(undefined).canActivate(contextFor(undefined, true).context)).toBe(true);
  });
});

describe('bearerToken', () => {
  it('reads only a single Bearer credential', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('Bearer abc def')).toBeNull();
    expect(bearerToken(['Bearer abc'])).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
