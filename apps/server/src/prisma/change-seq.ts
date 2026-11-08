import type { Prisma } from '../generated/prisma/client.js';

/** Advisory lock that makes card writes commit in changeSeq order. Any key no other code uses. */
const CHANGE_SEQ_LOCK_KEY = 4242001;

/**
 * Allocates the next pull cursor value. The transaction-level advisory lock is held from
 * allocation until commit, so transactions commit in changeSeq order and a pull can never
 * return N+1 while N is still uncommitted.
 *
 * Every card write in the system waits on this lock until the holder commits, so call it
 * last: only the card write and the `ProcessedMutation` insert should follow. Locks taken
 * before it (the card row, the device row) never wait on a holder of this lock, so the
 * order card → device → changeSeq cannot deadlock. A create has no card row to lock yet.
 */
export async function nextChangeSeq(tx: Prisma.TransactionClient): Promise<bigint> {
  // One round trip: the materialized CTE takes the lock before `nextval` runs.
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`
    WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(${CHANGE_SEQ_LOCK_KEY}::bigint))
    SELECT nextval('card_change_seq') AS seq FROM locked
  `;
  const seq = rows[0]?.seq;
  if (seq === undefined) throw new Error('card_change_seq returned no value');
  return BigInt(seq);
}
