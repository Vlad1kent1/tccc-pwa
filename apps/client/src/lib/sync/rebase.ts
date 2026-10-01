import { CHILD_COLLECTIONS, compareHlc, type CasualtyCard, type ChildEntity } from "@tccc/shared";
import type { LocalCasualtyCard, OutboxMutation, SyncStatus } from "@/lib/db";

function maxHlc(values: string[]): string | undefined {
  return values.reduce<string | undefined>((best, value) => {
    if (!best || compareHlc(value, best) > 0) return value;
    return best;
  }, undefined);
}

export function localFromServer(card: CasualtyCard, syncStatus: SyncStatus): LocalCasualtyCard {
  const clientUpdatedAt = maxHlc(Object.values(card.fieldClock)) ?? "0000000000000:0000:server";
  const { version, ...rest } = card;
  return {
    ...rest,
    injurySites: card.injurySites.map((row) => ({ ...row })),
    tourniquets: card.tourniquets.map((row) => ({ ...row })),
    vitalSigns: card.vitalSigns.map((row) => ({ ...row })),
    fluids: card.fluids.map((row) => ({ ...row })),
    medications: card.medications.map((row) => ({ ...row })),
    fieldClock: { ...card.fieldClock },
    syncStatus,
    serverVersion: version,
    clientUpdatedAt,
  };
}

function applyChild(card: LocalCasualtyCard, entity: ChildEntity, row: { id: string }): void {
  const key = CHILD_COLLECTIONS[entity];
  const rows = card[key] as { id: string }[];
  const next = rows.some((existing) => existing.id === row.id)
    ? rows.map((existing) => (existing.id === row.id ? row : existing))
    : [...rows, row];
  (card as Record<string, unknown>)[key] = next;
}

function tombstoneChild(card: LocalCasualtyCard, entity: ChildEntity, entityId: string, deletedAt: string, hlc: string): void {
  const key = CHILD_COLLECTIONS[entity];
  const rows = card[key] as { id: string; deletedAt: string | null; clientUpdatedAt: string }[];
  (card as Record<string, unknown>)[key] = rows.map((row) =>
    row.id === entityId ? { ...row, deletedAt, clientUpdatedAt: hlc } : row,
  );
}

/**
 * Copies the server aggregate, then replays still-queued local mutations on top.
 * Queued patches are the user's unsent edits and stay visible until the next push.
 */
export function rebaseCard(
  server: CasualtyCard,
  queued: OutboxMutation[],
  syncStatus: SyncStatus,
): LocalCasualtyCard {
  const card = localFromServer(server, queued.length > 0 && syncStatus !== "conflict" ? "pending" : syncStatus);
  const ordered = [...queued].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  for (const mutation of ordered) {
    if (mutation.op === "card.upsert") {
      Object.assign(card, mutation.patch);
      for (const field of mutation.changedFields) card.fieldClock[field] = mutation.hlc;
    } else if (mutation.op === "card.delete") {
      card.deletedAt = mutation.deletedAt;
    } else if (mutation.op === "child.upsert") {
      applyChild(card, mutation.entity, mutation.row);
    } else {
      tombstoneChild(card, mutation.entity, mutation.entityId, mutation.deletedAt, mutation.hlc);
    }
    if (compareHlc(mutation.hlc, card.clientUpdatedAt) > 0) card.clientUpdatedAt = mutation.hlc;
  }

  return card;
}
