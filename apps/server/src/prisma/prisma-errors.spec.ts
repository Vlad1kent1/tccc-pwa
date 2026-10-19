import { Prisma } from '../generated/prisma/client.js';
import { classifyDbError, dbErrorLines, describeDbError, MIGRATE_HINT, sqlState, summarize } from './prisma-errors.js';

function known(code: string, message = `Error ${code}`, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test', meta });
}

/** The shape Prisma 7 gives an error the pg driver adapter reported. */
function fromAdapter(code: string, originalCode: string, cause: Record<string, unknown> = {}, message = 'Database error') {
  const driverAdapterError = Object.assign(new Error('DriverAdapterError'), {
    cause: { kind: 'postgres', originalCode, originalMessage: `pg error ${originalCode}`, ...cause },
  });
  return known(code, message, { driverAdapterError });
}

describe('classifyDbError', () => {
  it.each([
    ['P2034', 'transient'],
    ['P2028', 'transient'],
    ['P1001', 'transient'],
    ['P1017', 'transient'],
    ['P2002', 'unique'],
    ['P2003', 'invalid-data'],
    ['P2011', 'invalid-data'],
    ['P2000', 'invalid-data'],
    ['P2025', 'not-found'],
    ['P2021', 'schema-drift'],
    ['P2022', 'schema-drift'],
    ['P9999', 'unknown'],
  ])('maps %s to %s', (code, kind) => {
    expect(classifyDbError(known(code))).toBe(kind);
  });

  it('classifies a passed-through Postgres error by its SQLSTATE', () => {
    expect(classifyDbError(fromAdapter('P2010', '55P03'))).toBe('transient');
    expect(classifyDbError(known('P2010', 'Raw query failed. Code: `40P01`. Message: `deadlock detected`'))).toBe(
      'transient',
    );
    expect(classifyDbError(fromAdapter('P2039', '08006'))).toBe('transient');
    expect(classifyDbError(fromAdapter('P2039', '23514'))).toBe('invalid-data');
    expect(classifyDbError(fromAdapter('P2039', '22P02'))).toBe('invalid-data');
    expect(classifyDbError(fromAdapter('P2039', '23505'))).toBe('unique');
    expect(classifyDbError(fromAdapter('P2039', '42703'))).toBe('schema-drift');
    expect(classifyDbError(fromAdapter('P2039', 'XX000'))).toBe('unknown');
  });

  it('treats a lost connection or a busy pool as transient and anything else as unknown', () => {
    expect(classifyDbError(new Error('timeout exceeded when trying to connect'))).toBe('transient');
    expect(
      classifyDbError(
        new Prisma.PrismaClientUnknownRequestError('Connection terminated unexpectedly', { clientVersion: 'test' }),
      ),
    ).toBe('transient');
    expect(classifyDbError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe('transient');
    expect(classifyDbError(new Prisma.PrismaClientInitializationError("Can't reach database server", 'test'))).toBe(
      'transient',
    );
    expect(
      classifyDbError(new Prisma.PrismaClientValidationError('Unknown argument `foo`', { clientVersion: 'test' })),
    ).toBe('unknown');
    expect(classifyDbError(new Error('boom'))).toBe('unknown');
    expect(classifyDbError('not an error')).toBe('unknown');
  });
});

describe('describeDbError', () => {
  it('gives the code, SQLSTATE, constraint, and the line of a multi-line message that says what failed', () => {
    const error = fromAdapter(
      'P2002',
      '23505',
      { constraint: { index: 'Tourniquet_cardId_limb_key' } },
      '\nInvalid `tx.tourniquet.upsert()` invocation:\n\n\nUnique constraint failed on the fields: (`cardId`,`limb`)',
    );
    const db = describeDbError(error);
    expect(db).toMatchObject({
      kind: 'unique',
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      sqlState: '23505',
      summary: 'Unique constraint failed on the fields: (`cardId`,`limb`)',
      detail: { constraint: { index: 'Tourniquet_cardId_limb_key' }, database: 'pg error 23505' },
    });
    expect(db.hint).toBeUndefined();
    expect(sqlState(error)).toBe('23505');
  });

  it('tells how to fix a database that is missing a migration', () => {
    const db = describeDbError(known('P2022', 'The column `InjurySite.siteCode` does not exist in the current database.'));
    expect(db).toMatchObject({ kind: 'schema-drift', code: 'P2022', hint: MIGRATE_HINT });
    expect(dbErrorLines(db)).toEqual([
      'PrismaClientKnownRequestError [P2022]: The column `InjurySite.siteCode` does not exist in the current database.',
      `hint: ${MIGRATE_HINT}`,
    ]);
  });

  it('describes an error that does not come from the database', () => {
    expect(dbErrorLines(describeDbError(new TypeError('card.fieldClock is undefined')))).toEqual([
      'TypeError: card.fieldClock is undefined',
    ]);
  });
});

describe('summarize', () => {
  it('drops terminal colors and keeps the last line', () => {
    const escape = String.fromCharCode(27);
    expect(summarize(new Error(`${escape}[31mInvalid invocation${escape}[39m\n\n  Null constraint violation`))).toBe(
      'Null constraint violation',
    );
    expect(summarize(new Error(''))).toBe('Unknown error');
  });

  it('explains a refused connection that pg reports as an empty AggregateError', () => {
    const refused = Object.assign(
      new AggregateError([new Error('connect ECONNREFUSED ::1:5434'), new Error('connect ECONNREFUSED 127.0.0.1:5434')], ''),
      { code: 'ECONNREFUSED' },
    );
    expect(summarize(refused)).toBe('connect ECONNREFUSED ::1:5434');
    expect(classifyDbError(refused)).toBe('transient');
    expect(summarize(Object.assign(new Error(''), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
  });
});
