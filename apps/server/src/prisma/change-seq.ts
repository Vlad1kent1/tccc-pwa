import type { Prisma } from '../generated/prisma/client.js';

/**
 * Allocates the next pull cursor value. Must be called inside the same
 * transaction that writes the card, so a rolled-back write never exposes a
 * cursor value to clients (gaps are fine, reordering is not).
 */
export async function nextChangeSeq(
  tx: Prisma.TransactionClient,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`
    SELECT nextval('card_change_seq') AS seq
  `;
  const seq = rows[0]?.seq;
  if (seq === undefined) {
    throw new Error('card_change_seq returned no value');
  }
  return BigInt(seq);
}
