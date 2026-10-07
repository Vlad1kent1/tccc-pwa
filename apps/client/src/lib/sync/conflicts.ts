import {
  CHILD_COLLECTIONS,
  childSchemas,
  type CardField,
  type CardPatch,
  type ChildEntity,
  type ChildRowByEntity,
  type ResolveConflictBody,
} from "@tccc/shared";
import { activeFlag, type LocalCasualtyCard, type LocalConflict, type OutboxMutation, type TcccDB } from "@/lib/db";
import { resolveConflict } from "./api";
import { rebaseCard } from "./rebase";

export interface QueuedDecision {
  keep: OutboxMutation[];
  dropSeqs: number[];
}

function hits(entry: OutboxMutation, conflict: LocalConflict): boolean {
  if (entry.cardId !== conflict.cardId) return false;
  if (conflict.entity === "card") {
    if (entry.op === "card.upsert") return entry.changedFields.includes(conflict.field as CardField);
    return entry.op === "card.delete" && conflict.field === "deletedAt";
  }
  if (entry.op === "child.upsert") return entry.entity === conflict.entity && entry.row.id === conflict.entityId;
  if (entry.op === "child.delete") return entry.entity === conflict.entity && entry.entityId === conflict.entityId;
  return false;
}

/**
 * Drops or trims queued mutations that would undo the choice on the next push.
 * Other fields in the same card patch stay queued, now based on the resolved version.
 */
export function queuedAfterDecision(entries: OutboxMutation[], conflict: LocalConflict, version: number): QueuedDecision {
  const keep: OutboxMutation[] = [];
  const dropSeqs: number[] = [];
  for (const entry of entries) {
    if (!hits(entry, conflict)) {
      keep.push({ ...entry, baseVersion: version });
      continue;
    }
    if (entry.op === "card.upsert" && conflict.entity === "card") {
      const changedFields = entry.changedFields.filter((field) => field !== conflict.field);
      if (changedFields.length === 0) {
        if (entry.seq != null) dropSeqs.push(entry.seq);
        continue;
      }
      const patch: CardPatch = { ...entry.patch };
      delete patch[conflict.field as CardField];
      keep.push({ ...entry, patch, changedFields, baseVersion: version });
      continue;
    }
    if (entry.seq != null) dropSeqs.push(entry.seq);
  }
  return { keep, dropSeqs };
}

function upsertChildRow<E extends ChildEntity>(
  card: LocalCasualtyCard,
  entity: E,
  row: ChildRowByEntity[E],
): LocalCasualtyCard {
  const key = CHILD_COLLECTIONS[entity];
  const rows = card[key] as ChildRowByEntity[E][];
  const index = rows.findIndex((item) => item.id === row.id);
  const next = index === -1 ? [...rows, row] : rows.map((item, itemIndex) => (itemIndex === index ? row : item));
  return { ...card, [key]: next };
}

/**
 * Puts the losing value back onto the local card. A child collision replaces the
 * row with that id; it does not attach a `row` property to the existing row.
 */
export function restoreDiscarded(card: LocalCasualtyCard, conflict: LocalConflict): LocalCasualtyCard {
  if (conflict.entity === "card") {
    const next = { ...card, [conflict.field]: conflict.discarded ?? null } as LocalCasualtyCard;
    return conflict.field === "deletedAt" ? { ...next, active: activeFlag(next.deletedAt) } : next;
  }
  const entity = conflict.entity;
  if (conflict.field === "row") {
    const parsed = childSchemas[entity].safeParse({
      ...(conflict.discarded && typeof conflict.discarded === "object" ? conflict.discarded : {}),
      id: conflict.entityId,
      cardId: conflict.cardId,
    });
    if (!parsed.success) return card;
    return upsertChildRow(card, entity, parsed.data as ChildRowByEntity[typeof entity]);
  }
  if (conflict.field === "deletedAt") {
    const key = CHILD_COLLECTIONS[entity];
    const rows = card[key] as Array<{ id: string; deletedAt: string | null }>;
    if (!rows.some((row) => row.id === conflict.entityId)) return card;
    const deletedAt = typeof conflict.discarded === "string" ? conflict.discarded : null;
    return {
      ...card,
      [key]: rows.map((row) => (row.id === conflict.entityId ? { ...row, deletedAt } : row)),
    };
  }
  return card;
}

/** Posts the choice, then stores the server card and closes the local conflict together. */
export async function resolveLocalConflict(
  db: TcccDB,
  conflict: LocalConflict,
  choice: ResolveConflictBody["choice"],
): Promise<void> {
  const response = await resolveConflict(conflict.id, choice);
  await db.transaction("rw", [db.casualties, db.conflicts, db.outbox], async () => {
    const queued = await db.outbox
      .where("cardId")
      .equals(conflict.cardId)
      .and((entry) => entry.status === "queued")
      .sortBy("seq");
    const { keep, dropSeqs } = queuedAfterDecision(queued, conflict, response.card.version);
    if (dropSeqs.length > 0) await db.outbox.bulkDelete(dropSeqs);
    const rewritten = keep.filter((entry) => entry.seq != null);
    if (rewritten.length > 0) await db.outbox.bulkPut(rewritten);

    const others = await db.conflicts
      .where("[cardId+open]")
      .equals([conflict.cardId, 1])
      .filter((row) => row.id !== conflict.id)
      .count();
    const status = others > 0 ? "conflict" : keep.length > 0 ? "pending" : "synced";
    const rebased = rebaseCard(response.card, keep, status);
    const next = choice === "discarded" ? restoreDiscarded(rebased, conflict) : rebased;
    await db.casualties.put(next);
    await db.conflicts.update(conflict.id, { resolvedAt: new Date().toISOString(), open: 0 });
  });
}
