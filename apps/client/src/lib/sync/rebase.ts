import { CARD_FIELDS, CHILD_COLLECTIONS, compareHlc, isNewerHlc, type CasualtyCard, type ChildEntity } from "@tccc/shared";
import { activeFlag, type LocalCasualtyCard, type OutboxMutation, type SyncStatus } from "@/lib/db";
import { withSiteCode } from "@/lib/db/injury-site-code";

/** Card fields that carry their own clock, `deletedAt` included. */
const CLOCKED_FIELDS = [...CARD_FIELDS, "deletedAt"] as const;
type ClockedField = (typeof CLOCKED_FIELDS)[number];

const COLLECTIONS = Object.values(CHILD_COLLECTIONS);
type Collection = (typeof COLLECTIONS)[number];

interface ClockedRow {
  id: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
}

function maxHlc(values: string[]): string | undefined {
  return values.reduce<string | undefined>((best, value) => {
    if (!best || compareHlc(value, best) > 0) return value;
    return best;
  }, undefined);
}

/** Newest field clock on a server aggregate. */
export function aggregateClock(fieldClock: Record<string, string>): string {
  return maxHlc(Object.values(fieldClock)) ?? "0000000000000:0000:server";
}

/** Newest clock anywhere on a card: its fields and every child row. */
export function newestClock(card: Pick<LocalCasualtyCard, "fieldClock" | Collection>): string {
  const rows = COLLECTIONS.flatMap((key) => (card[key] as ClockedRow[]).map((row) => row.clientUpdatedAt));
  return maxHlc([...Object.values(card.fieldClock), ...rows]) ?? "0000000000000:0000:server";
}

export function localFromServer(card: CasualtyCard, syncStatus: SyncStatus): LocalCasualtyCard {
  const { version, ...rest } = card;
  return {
    ...rest,
    // A device that has not updated yet still writes the site code into `description`.
    injurySites: card.injurySites.map((row) => withSiteCode({ ...row })),
    tourniquets: card.tourniquets.map((row) => ({ ...row })),
    vitalSigns: card.vitalSigns.map((row) => ({ ...row })),
    fluids: card.fluids.map((row) => ({ ...row })),
    medications: card.medications.map((row) => ({ ...row })),
    fieldClock: { ...card.fieldClock },
    syncStatus,
    serverVersion: version,
    clientUpdatedAt: newestClock(card),
    active: activeFlag(card.deletedAt),
  };
}

function setField(card: LocalCasualtyCard, field: ClockedField, value: unknown, clock: string): void {
  (card as Record<string, unknown>)[field] = value;
  card.fieldClock[field] = clock;
}

function rowsOf(card: LocalCasualtyCard, key: Collection): ClockedRow[] {
  return card[key] as ClockedRow[];
}

/**
 * Child rows by last-writer-wins on `clientUpdatedAt`. A row only this device has
 * is kept, unless it is a tombstone: the server never hard-deletes a row, so a row
 * it lacks has not reached it yet, and a deleted one has nothing left to show.
 */
function mergeRows(server: ClockedRow[], local: ClockedRow[]): ClockedRow[] {
  const mine = new Map(local.map((row) => [row.id, row]));
  const merged = server.map((row) => {
    const own = mine.get(row.id);
    return own && isNewerHlc(own.clientUpdatedAt, row.clientUpdatedAt) ? own : row;
  });
  const onServer = new Set(server.map((row) => row.id));
  for (const row of local) {
    if (!onServer.has(row.id) && row.deletedAt == null) merged.push(row);
  }
  return merged;
}

/** Replays one queued mutation; each value applies only where its clock is newer. */
function replay(card: LocalCasualtyCard, mutation: OutboxMutation): void {
  if (mutation.op === "card.upsert") {
    for (const field of mutation.changedFields) {
      if (isNewerHlc(mutation.hlc, card.fieldClock[field])) setField(card, field, mutation.patch[field], mutation.hlc);
    }
    return;
  }
  if (mutation.op === "card.delete") {
    if (isNewerHlc(mutation.hlc, card.fieldClock.deletedAt)) setField(card, "deletedAt", mutation.deletedAt, mutation.hlc);
    return;
  }
  const key = CHILD_COLLECTIONS[mutation.entity as ChildEntity];
  const rows = rowsOf(card, key);
  if (mutation.op === "child.upsert") {
    const row = mutation.row as ClockedRow;
    const existing = rows.find((item) => item.id === row.id);
    if (existing && !isNewerHlc(row.clientUpdatedAt, existing.clientUpdatedAt)) return;
    (card as Record<string, unknown>)[key] = existing ? rows.map((item) => (item.id === row.id ? row : item)) : [...rows, row];
    return;
  }
  const existing = rows.find((item) => item.id === mutation.entityId);
  if (!existing || !isNewerHlc(mutation.hlc, existing.clientUpdatedAt)) return;
  (card as Record<string, unknown>)[key] = rows.map((item) =>
    item.id === mutation.entityId ? { ...item, deletedAt: mutation.deletedAt, clientUpdatedAt: mutation.hlc } : item,
  );
}

/**
 * Merges a server aggregate into the local card, field by field and row by row,
 * newest clock first: the server's value wins unless the local one is newer.
 * Queued edits are then replayed under the same rule, so an unsent edit stays
 * visible until the push, and one the server will reject as older is not shown.
 *
 * Nothing is skipped as a whole: another device's edit with an older clock than
 * this device's latest edit still lands in the fields it touched.
 * `clientUpdatedAt` is left as stored; the caller re-stamps a card whose content changed.
 */
export function rebaseCard(
  server: CasualtyCard,
  queued: OutboxMutation[],
  syncStatus: SyncStatus,
  stored?: LocalCasualtyCard,
): LocalCasualtyCard {
  const card = localFromServer(server, queued.length > 0 && syncStatus !== "conflict" ? "pending" : syncStatus);

  if (stored) {
    for (const field of CLOCKED_FIELDS) {
      const own = stored.fieldClock[field];
      if (own && isNewerHlc(own, card.fieldClock[field])) setField(card, field, stored[field], own);
    }
    for (const key of COLLECTIONS) {
      (card as Record<string, unknown>)[key] = mergeRows(rowsOf(card, key), rowsOf(stored, key));
    }
    card.clientUpdatedAt = stored.clientUpdatedAt;
  }

  for (const mutation of [...queued].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    replay(card, mutation);
    if (!stored && compareHlc(mutation.hlc, card.clientUpdatedAt) > 0) card.clientUpdatedAt = mutation.hlc;
  }

  card.active = activeFlag(card.deletedAt);
  return card;
}

/** JSON with object keys sorted, so rows written by different code compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

function rowsById(rows: ClockedRow[]): string {
  return canonical([...rows].sort((a, b) => a.id.localeCompare(b.id)));
}

/** Whether a medic would see any difference: card fields, deletion, and child rows. */
export function sameCardContent(a: LocalCasualtyCard, b: LocalCasualtyCard): boolean {
  if (CLOCKED_FIELDS.some((field) => canonical(a[field]) !== canonical(b[field]))) return false;
  return COLLECTIONS.every((key) => rowsById(rowsOf(a, key)) === rowsById(rowsOf(b, key)));
}

/** Whether two stored records are identical, metadata included. */
export function sameRecord(a: LocalCasualtyCard, b: LocalCasualtyCard): boolean {
  return canonical({ ...a, ...Object.fromEntries(COLLECTIONS.map((key) => [key, rowsById(rowsOf(a, key))])) }) ===
    canonical({ ...b, ...Object.fromEntries(COLLECTIONS.map((key) => [key, rowsById(rowsOf(b, key))])) });
}
