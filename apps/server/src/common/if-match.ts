import { HttpException, HttpStatus, PreconditionFailedException } from '@nestjs/common';

/** Reads `If-Match: <version>` (quotes and a weak-validator prefix are accepted). */
export function parseIfMatch(header: string | string[] | undefined): number {
  const rawHeader = Array.isArray(header) ? header[0] : header;
  if (rawHeader === undefined || rawHeader.trim() === '') {
    throw new HttpException('If-Match header is required', HttpStatus.PRECONDITION_REQUIRED);
  }
  const raw = rawHeader.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!/^\d+$/.test(raw)) {
    throw new HttpException('If-Match must be a card version', HttpStatus.PRECONDITION_REQUIRED);
  }
  return Number(raw);
}

export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new PreconditionFailedException({
      message: 'Version mismatch',
      currentVersion: actual,
    });
  }
}
