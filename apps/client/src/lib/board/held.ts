import type { HeldBoardEdits } from "@/lib/db";
import {
  emptyPendingRows,
  fieldValue,
  findRow,
  isHeldField,
  overlayRow,
  ROW_KINDS,
  sameField,
  sameRow,
  takeRemote,
  type AnyBoardRow,
  type Clash,
  type PendingRows,
} from "./pending";
import type { BoardSnapshot } from "./snapshot";

/**
 * Held clashing edits (shared conflict policy) are not saved until the medic chooses, so they are
 * kept locally to survive a reload, a closed tab or a killed PWA (P2-031). Only the medic's side
 * is kept: the other version is the stored card, read again when the edits come back.
 */
export function heldEditsOf(clash: Clash | null, snapshot: BoardSnapshot, pending: PendingRows): HeldBoardEdits | null {
  if (!clash) return null;
  const held: HeldBoardEdits = { fields: {}, rows: {} };
  let any = false;
  for (const key of clash.fields.keys()) {
    if (!isHeldField(key)) continue;
    held.fields[key] = fieldValue(snapshot, key) ?? null;
    any = true;
  }
  for (const kind of ROW_KINDS) {
    for (const key of clash.rows[kind].keys()) {
      const removed = pending[kind].removed.has(key);
      const row = removed ? null : findRow(snapshot, kind, key);
      if (!removed && !row) continue;
      (held.rows[kind] ??= {})[key] = {
        row: (row ?? null) as Record<string, unknown> | null,
        columns: [...(pending[kind].changed.get(key) ?? [])],
      };
      any = true;
    }
  }
  return any ? held : null;
}

/**
 * The part of `clash` still unsaved. After "Keep my edits" the kept cells stay in the local copy
 * until the save that stores them succeeds, so a failed save followed by a kill loses nothing.
 */
export function stillUnsaved(clash: Clash | null, dirtyKeys: ReadonlySet<string>, pending: PendingRows): Clash | null {
  if (!clash) return null;
  const next: Clash = {
    fields: new Map([...clash.fields].filter(([key]) => dirtyKeys.has(key))),
    rows: Object.fromEntries(
      ROW_KINDS.map((kind) => [
        kind,
        new Map([...clash.rows[kind]].filter(([key]) => pending[kind].changed.has(key) || pending[kind].removed.has(key))),
      ]),
    ) as Clash["rows"],
  };
  return next.fields.size === 0 && ROW_KINDS.every((kind) => next.rows[kind].size === 0) ? null : next;
}

/** Held edits put back on a board: the shown snapshot, the unsaved fields and rows, and the clash. */
export interface RestoredHeld {
  snapshot: BoardSnapshot;
  fields: string[];
  rows: PendingRows;
  clash: Clash | null;
}

/**
 * Puts kept held edits back on top of `current`, against the card as now `stored`. An edit the
 * other device has since matched is dropped. Where the medic edited the same value again since
 * opening, the newer edit wins (a row keeps the kept columns the medic has not retyped). Every
 * other edit is held again, with the stored value as the other version.
 */
export function restoreHeldEdits(
  held: HeldBoardEdits,
  current: BoardSnapshot,
  stored: BoardSnapshot,
  dirtyKeys: ReadonlySet<string>,
  pending: PendingRows,
  /**
   * Saved since opening, so newer than the kept value, which is dropped: field keys,
   * `kind:rowKey:column` for saved row columns, and `kind:rowKey` for removed rows.
   */
  savedSince: { fields: ReadonlySet<string>; rows: ReadonlySet<string> } = { fields: new Set(), rows: new Set() },
): RestoredHeld {
  const mine: Clash = { fields: new Map(), rows: Object.fromEntries(ROW_KINDS.map((kind) => [kind, new Map()])) as Clash["rows"] };
  const clash: Clash = { fields: new Map(), rows: Object.fromEntries(ROW_KINDS.map((kind) => [kind, new Map()])) as Clash["rows"] };
  const rows = emptyPendingRows();
  const fields: string[] = [];
  for (const [key, keptValue] of Object.entries(held.fields)) {
    if (!isHeldField(key) || (savedSince.fields.has(key) && !dirtyKeys.has(key))) continue;
    const value = dirtyKeys.has(key) ? fieldValue(current, key) : keptValue;
    const theirs = fieldValue(stored, key);
    if (sameField(value, theirs)) continue;
    mine.fields.set(key, value);
    clash.fields.set(key, theirs);
    fields.push(key);
  }
  for (const kind of ROW_KINDS) {
    for (const [key, keptEntry] of Object.entries(held.rows[kind] ?? {})) {
      let entry = keptEntry;
      const retypedOrPending = pending[kind].changed.has(key) || pending[kind].removed.has(key);
      if (!retypedOrPending) {
        // A row removed since wins; columns saved since win over the kept ones, the rest stay held.
        if (savedSince.rows.has(`${kind}:${key}`)) continue;
        const columns = entry.columns.filter((column) => !savedSince.rows.has(`${kind}:${key}:${column}`));
        if (entry.row && columns.length === 0) continue;
        entry = { ...entry, columns };
      }
      const theirs = findRow(stored, kind, key);
      const retyped = pending[kind].changed.get(key);
      // A newer removal wins; a newer edit keeps the kept columns it did not retype.
      const removed = pending[kind].removed.has(key) || (!entry.row && !retyped);
      const shown = findRow(current, kind, key);
      const kept = removed
        ? null
        : retyped && shown
          ? overlayRow(shown, (entry.row as AnyBoardRow | null) ?? shown, entry.columns.filter((column) => !retyped.has(column)))
          : (entry.row as AnyBoardRow | null);
      const columns = [...new Set([...entry.columns, ...(retyped ?? [])])];
      if (kept ? theirs && sameRow(theirs, kept, columns) : !theirs) continue;
      mine.rows[kind].set(key, kept && theirs ? overlayRow(theirs, kept, columns) : kept);
      clash.rows[kind].set(key, theirs ?? null);
      if (kept) rows[kind].changed.set(key, new Set(columns));
      else rows[kind].removed.add(key);
    }
  }
  const empty = fields.length === 0 && ROW_KINDS.every((kind) => clash.rows[kind].size === 0);
  return { snapshot: takeRemote(current, mine), fields, rows, clash: empty ? null : clash };
}
