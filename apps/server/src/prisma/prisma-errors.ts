import { Prisma } from '../generated/prisma/client.js';

/**
 * How the API answers a database failure.
 * - `transient`: nothing is wrong with the request and the same call can succeed later
 *   (lock or serialization conflict, transaction timeout, lost connection, busy pool).
 * - `invalid-data`: the database refused the values (constraint, length, range, type).
 * - `unique`: a unique constraint refused the write.
 * - `not-found`: a record the write needs does not exist.
 * - `schema-drift`: the database lacks a table or column the generated client expects.
 * - `unknown`: anything else, including a query the server built wrongly.
 */
export type DbErrorKind = 'transient' | 'invalid-data' | 'unique' | 'not-found' | 'schema-drift' | 'unknown';

export interface DbErrorDescription {
  kind: DbErrorKind;
  name: string;
  /** Prisma error code (P2002, ...) or a socket code (ECONNRESET, ...). */
  code: string | null;
  /** Postgres SQLSTATE reported by the driver adapter, when there is one. */
  sqlState: string | null;
  /** The last line of the message, where Prisma says what failed. */
  summary: string;
  /** Constraint, table, column, or model the database named. */
  detail?: Record<string, unknown>;
  hint?: string;
}

export const MIGRATE_HINT =
  'The database is behind prisma/schema.prisma: apply the migrations with `pnpm db:migrate` (or `prisma migrate deploy`).';

const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034', 'P2037']);
const INVALID_DATA_CODES = new Set([
  'P2000', 'P2003', 'P2004', 'P2005', 'P2006', 'P2007', 'P2011', 'P2012', 'P2013', 'P2014', 'P2019', 'P2020',
  'P2023', 'P2033',
]);
const NOT_FOUND_CODES = new Set(['P2001', 'P2015', 'P2018', 'P2025']);
const SCHEMA_DRIFT_CODES = new Set(['P2021', 'P2022']);
/** A Postgres error passed through as is: P2010 from `$queryRaw`, P2039 from other queries (Prisma 7 adapters). */
const WRAPPED_CODES = new Set(['P2010', 'P2039']);

/** Serialization failure, deadlock, lock_timeout, statement_timeout, server shutdown, too many connections. */
const TRANSIENT_SQLSTATES = new Set(['40001', '40P01', '55P03', '57014', '57P01', '57P02', '57P03', '53300']);
const SCHEMA_DRIFT_SQLSTATES = new Set(['42P01', '42703']);

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);
/** `pg` pool and socket failures that carry no code. */
const NETWORK_MESSAGE = /timeout exceeded when trying to connect|connection terminated|connection timeout/i;

const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function isPrismaError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientValidationError
  );
}

export function classifyDbError(error: unknown): DbErrorKind {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return classifyCode(error.code, sqlState(error));
  }
  if (error instanceof Prisma.PrismaClientInitializationError || isNetworkFailure(error)) {
    return 'transient';
  }
  return 'unknown';
}

/** The Postgres SQLSTATE behind a Prisma error, when the driver adapter reported one. */
export function sqlState(error: unknown): string | null {
  const original = adapterCause(error)?.originalCode;
  if (typeof original === 'string' && original !== 'N/A') return original;
  if (error instanceof Prisma.PrismaClientKnownRequestError && WRAPPED_CODES.has(error.code)) {
    return /Code: `([0-9A-Z]{5})`/.exec(error.message)?.[1] ?? null;
  }
  return null;
}

export function describeDbError(error: unknown): DbErrorDescription {
  const kind = classifyDbError(error);
  const cause = adapterCause(error);
  const meta = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined;
  const detail = defined({
    modelName: meta?.modelName,
    target: meta?.target,
    constraint: cause?.constraint,
    table: cause?.table,
    column: cause?.column,
    database: cause?.originalMessage,
  });
  return {
    kind,
    name: error instanceof Error ? error.name : typeof error,
    code: errorCode(error),
    sqlState: sqlState(error),
    summary: summarize(error),
    ...(detail ? { detail } : {}),
    ...(kind === 'schema-drift' ? { hint: MIGRATE_HINT } : {}),
  };
}

/** Log lines for a described error: what failed, what the database named, and how to fix schema drift. */
export function dbErrorLines(db: DbErrorDescription): string[] {
  const codes = [db.code, db.sqlState ? `SQLSTATE ${db.sqlState}` : null].filter(Boolean).join(', ');
  return [
    `${db.name}${codes ? ` [${codes}]` : ''}: ${db.summary}`,
    ...(db.detail ? [`detail: ${JSON.stringify(db.detail)}`] : []),
    ...(db.hint ? [`hint: ${db.hint}`] : []),
  ];
}

/** The last non-empty line of the message, without terminal colors. */
export function summarize(error: unknown): string {
  const lines = messageOf(error)
    .replace(ANSI_COLOR, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? errorCode(error) ?? 'Unknown error').slice(0, 300);
}

/** The message, or for an empty `AggregateError` (every database address refused) the first inner one. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!error.message && error instanceof AggregateError) {
    const inner = error.errors.find((item): item is Error => item instanceof Error && item.message !== '');
    if (inner) return inner.message;
  }
  return error.message;
}

function classifyCode(code: string, state: string | null): DbErrorKind {
  if (code === 'P2002') return 'unique';
  if (TRANSIENT_CODES.has(code)) return 'transient';
  if (INVALID_DATA_CODES.has(code)) return 'invalid-data';
  if (NOT_FOUND_CODES.has(code)) return 'not-found';
  if (SCHEMA_DRIFT_CODES.has(code)) return 'schema-drift';
  if (WRAPPED_CODES.has(code) && state) return classifySqlState(state);
  return 'unknown';
}

function classifySqlState(state: string): DbErrorKind {
  if (state === '23505') return 'unique';
  if (TRANSIENT_SQLSTATES.has(state) || state.startsWith('08')) return 'transient';
  if (SCHEMA_DRIFT_SQLSTATES.has(state)) return 'schema-drift';
  // Class 22 is a data exception, class 23 an integrity constraint violation (e.g. a CHECK).
  if (state.startsWith('22') || state.startsWith('23')) return 'invalid-data';
  return 'unknown';
}

/** Looks through the error and its causes for a socket or pool failure. */
function isNetworkFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const code = errorCode(current);
    if ((code && NETWORK_CODES.has(code)) || NETWORK_MESSAGE.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/** `cause` of the driver adapter error that Prisma 7 keeps in `meta.driverAdapterError`. */
function adapterCause(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const adapterError = (error.meta as { driverAdapterError?: { cause?: unknown } } | undefined)?.driverAdapterError;
  const cause = adapterError?.cause;
  return typeof cause === 'object' && cause !== null ? (cause as Record<string, unknown>) : null;
}

function errorCode(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : null;
}

function defined(values: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined && value !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
