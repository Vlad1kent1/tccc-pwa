import { HLC_PATTERN, isNewerHlc, type CardField, type ChildEntity, type SyncConflictInfo } from '@tccc/shared';

/** A value that lost last-writer-wins, ready to persist as a `SyncConflict`. */
export interface DiscardedValue {
  entity: SyncConflictInfo['entity'];
  entityId: string;
  field: string;
  kept: unknown;
  discarded: unknown;
  /** True when the incoming write is the one that was discarded. */
  incomingLost: boolean;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * True when one device stamped both clocks (an HLC ends with the device id). A device's
 * writes are ordered by its own clock, so one replacing another is an edit, never a
 * conflict to review. It happens when a device's create and first edit reach the
 * server in one push, before the create was acknowledged.
 */
export function sameWriter(storedClock: string, incomingClock: string): boolean {
  const writer = HLC_PATTERN.exec(storedClock)?.[3];
  return writer !== undefined && writer === HLC_PATTERN.exec(incomingClock)?.[3];
}

/**
 * Field-level last-writer-wins. A missing stored clock is older than any
 * incoming clock. Equal clocks keep the stored value (the incoming clock is
 * not strictly newer). Identical values produce no conflict, and neither does
 * replacing a value nobody wrote: a field without a clock still holds its
 * default (a field the creating mutation left out, or one added to the schema later).
 * Nor does a device replacing its own earlier value (`sameWriter`).
 */
export function mergeField(args: {
  entity: SyncConflictInfo['entity'];
  entityId: string;
  field: string;
  stored: unknown;
  incoming: unknown;
  storedClock: string | null | undefined;
  incomingClock: string;
}): { value: unknown; clock: string; discarded: DiscardedValue | null } {
  const incomingWins = isNewerHlc(args.incomingClock, args.storedClock);
  const value = incomingWins ? args.incoming : args.stored;
  const clock = incomingWins ? args.incomingClock : (args.storedClock ?? args.incomingClock);
  const discardedValue = incomingWins ? args.stored : args.incoming;
  if (args.storedClock == null || sameWriter(args.storedClock, args.incomingClock) || sameJson(value, discardedValue)) {
    return { value, clock, discarded: null };
  }
  return {
    value,
    clock,
    discarded: {
      entity: args.entity,
      entityId: args.entityId,
      field: args.field,
      kept: value,
      discarded: discardedValue,
      incomingLost: !incomingWins,
    },
  };
}

export interface ChildClockRow {
  id: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
}

/**
 * Row-level last-writer-wins. The whole incoming row replaces the stored row
 * only when its `clientUpdatedAt` is strictly newer. A missing stored row is
 * an insert and records nothing, and so is a row the same device wrote both times.
 */
export function mergeChildRow<T extends ChildClockRow>(args: {
  entity: ChildEntity;
  stored: T | null;
  incoming: T;
}): { row: T; discarded: DiscardedValue | null } {
  if (!args.stored) {
    return { row: args.incoming, discarded: null };
  }
  const incomingWins = isNewerHlc(args.incoming.clientUpdatedAt, args.stored.clientUpdatedAt);
  const row = incomingWins ? args.incoming : args.stored;
  const loser = incomingWins ? args.stored : args.incoming;
  if (sameJson(row, loser) || sameWriter(args.stored.clientUpdatedAt, args.incoming.clientUpdatedAt)) {
    return { row, discarded: null };
  }
  return {
    row,
    discarded: {
      entity: args.entity,
      entityId: args.stored.id,
      field: 'row',
      kept: row,
      discarded: loser,
      incomingLost: !incomingWins,
    },
  };
}

/**
 * A tombstone is a field value on the child row. It wins only when the
 * mutation clock is strictly newer than the row's `clientUpdatedAt`.
 */
export function mergeTombstone<T extends ChildClockRow>(args: {
  entity: ChildEntity;
  stored: T;
  deletedAt: string;
  hlc: string;
}): { row: T; discarded: DiscardedValue | null } {
  const merged = mergeField({
    entity: args.entity,
    entityId: args.stored.id,
    field: 'deletedAt',
    stored: args.stored.deletedAt,
    incoming: args.deletedAt,
    storedClock: args.stored.clientUpdatedAt,
    incomingClock: args.hlc,
  });
  const row = merged.value === args.stored.deletedAt
    ? args.stored
    : { ...args.stored, deletedAt: args.deletedAt, clientUpdatedAt: args.hlc };
  return { row, discarded: merged.discarded };
}

// ── Per-mutation decisions ────────────────────────────────────────────────
//
// Every mutation is merged by clock, whatever its `baseVersion`. A matching base
// version (the "fast path") only means the device had seen the stored value, so
// replacing it is an ordinary edit rather than a conflict. It does not make the
// write newer: an offline edit can reach the server after a newer edit from
// another device, and the device rebases its queued edits onto each version it
// receives, so its base version can match while its clock is older.

/** On the fast path only a write that lost is a conflict; otherwise every discarded value is. */
export function conflictToRecord(discarded: DiscardedValue | null, fastPath: boolean): DiscardedValue | null {
  if (!discarded) return null;
  return fastPath && !discarded.incomingLost ? null : discarded;
}

/** Card fields that win by clock, and the conflicts to record. */
export function mergeCardPatch(args: {
  cardId: string;
  stored: Readonly<Record<string, unknown>>;
  storedClock: Readonly<Record<string, string>>;
  patch: Readonly<Partial<Record<CardField, unknown>>>;
  changedFields: readonly CardField[];
  hlc: string;
  fastPath: boolean;
}): { columns: Partial<Record<CardField, unknown>>; clock: Record<string, string>; discarded: DiscardedValue[] } {
  const clock = { ...args.storedClock };
  const columns: Partial<Record<CardField, unknown>> = {};
  const discarded: DiscardedValue[] = [];
  for (const field of args.changedFields) {
    const merged = mergeField({
      entity: 'card',
      entityId: args.cardId,
      field,
      stored: args.stored[field],
      incoming: args.patch[field],
      storedClock: clock[field],
      incomingClock: args.hlc,
    });
    if (isNewerHlc(merged.clock, clock[field])) {
      columns[field] = merged.value;
      clock[field] = merged.clock;
    }
    const conflict = conflictToRecord(merged.discarded, args.fastPath);
    if (conflict) discarded.push(conflict);
  }
  return { columns, clock, discarded };
}

/** The card's `deletedAt` after a delete, by clock. */
export function mergeCardDelete(args: {
  cardId: string;
  storedDeletedAt: string | null;
  storedClock: Readonly<Record<string, string>>;
  deletedAt: string;
  hlc: string;
  fastPath: boolean;
}): { deletedAt: string | null; clock: Record<string, string>; discarded: DiscardedValue[] } {
  const merged = mergeField({
    entity: 'card',
    entityId: args.cardId,
    field: 'deletedAt',
    stored: args.storedDeletedAt,
    incoming: args.deletedAt,
    storedClock: args.storedClock.deletedAt,
    incomingClock: args.hlc,
  });
  const conflict = conflictToRecord(merged.discarded, args.fastPath);
  return {
    deletedAt: merged.value as string | null,
    clock: { ...args.storedClock, deletedAt: merged.clock },
    discarded: conflict ? [conflict] : [],
  };
}

/** The row to write for a child upsert, or null when the stored row is newer. */
export function mergeChildUpsert<T extends ChildClockRow>(args: {
  entity: ChildEntity;
  stored: T | null;
  incoming: T;
  fastPath: boolean;
}): { write: T | null; discarded: DiscardedValue[] } {
  const merged = mergeChildRow({ entity: args.entity, stored: args.stored, incoming: args.incoming });
  const incomingWins = !args.stored || merged.row === args.incoming;
  const conflict = conflictToRecord(merged.discarded, args.fastPath);
  return { write: incomingWins ? merged.row : null, discarded: conflict ? [conflict] : [] };
}

/** The tombstoned row to write for a child delete, or null when a newer edit keeps the row. */
export function mergeChildDelete<T extends ChildClockRow>(args: {
  entity: ChildEntity;
  stored: T;
  deletedAt: string;
  hlc: string;
  fastPath: boolean;
}): { write: T | null; discarded: DiscardedValue[] } {
  const merged = mergeTombstone({ entity: args.entity, stored: args.stored, deletedAt: args.deletedAt, hlc: args.hlc });
  const changed = merged.row.deletedAt !== args.stored.deletedAt || merged.row.clientUpdatedAt !== args.stored.clientUpdatedAt;
  const conflict = conflictToRecord(merged.discarded, args.fastPath);
  return { write: changed ? merged.row : null, discarded: conflict ? [conflict] : [] };
}
