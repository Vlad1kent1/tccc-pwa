import type { Logger } from '@nestjs/common';

/** Longest request or mutation payload written to the log, in characters. */
export const MAX_LOGGED_PAYLOAD = 8_000;

/**
 * Request and mutation payloads are logged with server errors unless `LOG_ERROR_PAYLOADS=false`.
 * They hold casualty data (names, notes), so turn this off where logs leave the unit.
 */
export function payloadLoggingEnabled(): boolean {
  return process.env.LOG_ERROR_PAYLOADS !== 'false';
}

/** JSON for the log, cut to `max` characters. */
export function formatPayload(value: unknown, max = MAX_LOGGED_PAYLOAD): string {
  let json: string;
  try {
    json = JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)) ?? String(value);
  } catch {
    json = String(value);
  }
  return json.length > max ? `${json.slice(0, max)}…(+${json.length - max} chars)` : json;
}

/** Logs the lines as one entry, followed by the error's stack trace when it has one. */
export function logError(logger: Logger, lines: string[], error: unknown): void {
  const message = lines.join('\n  ');
  const stack = error instanceof Error ? error.stack : undefined;
  if (stack) logger.error(message, stack);
  else logger.error(message);
}
