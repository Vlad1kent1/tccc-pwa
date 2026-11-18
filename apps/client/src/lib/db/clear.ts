import { listHeldBoardEdits } from "./meta";
import type { TcccDB } from "./schema";

export type ClearBlock = "pending" | "held" | null;

/**
 * Why clearing local cards must wait: queued changes not yet synced, or board edits held for the
 * medic's choice on a card that can still be opened (P2-031). Held edits of a card already deleted
 * cannot be chosen for, so they never block. Must run inside a transaction that reads `outbox`,
 * `casualties` and `meta` when used to guard a clear.
 */
export async function clearBlockedBy(db: TcccDB): Promise<ClearBlock> {
  if ((await db.outbox.count()) > 0) return "pending";
  for (const id of Object.keys(await listHeldBoardEdits(db))) {
    const card = await db.casualties.get(id);
    if (card && card.deletedAt == null) return "held";
  }
  return null;
}

/**
 * Deletes every casualty card on this device, with its conflicts and held board edits, in one
 * transaction that re-checks `clearBlockedBy` first. Returns what blocked it, or null once cleared.
 */
export async function clearLocalCards(db: TcccDB): Promise<ClearBlock> {
  return db.transaction("rw", [db.casualties, db.conflicts, db.meta, db.outbox], async () => {
    const block = await clearBlockedBy(db);
    if (block) return block;
    await db.casualties.clear();
    await db.conflicts.clear();
    await db.meta.delete("heldBoardEdits");
    return null;
  });
}
