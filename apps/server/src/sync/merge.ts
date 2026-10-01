import { isNewerHlc, type ChildEntity, type SyncConflictInfo } from '@tccc/shared';

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
 * Field-level last-writer-wins. A missing stored clock is older than any
 * incoming clock. Equal clocks keep the stored value (the incoming clock is
 * not strictly newer). Identical values produce no conflict.
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
  if (sameJson(value, discardedValue)) {
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
 * an insert and records nothing.
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
  if (sameJson(row, loser)) {
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
