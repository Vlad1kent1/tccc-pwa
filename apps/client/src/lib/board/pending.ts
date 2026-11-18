import { REVIEW_CARD_FIELDS } from "@tccc/shared";
import { normalizeText } from "@/lib/forms/card-patch";
import type { BoardSlice, BoardSnapshot } from "./snapshot";

/**
 * What the medic changed on the board and has not saved yet, so a save writes only that
 * and a card from another device can be merged around it (P1-003). Card fields are
 * tracked by key in `BoardStore.dirtyKeys` (one `rowDrafts:<row id>` key per row draft);
 * child rows here, by row key and column.
 */
export type RowKind = "injuries" | "tourniquets" | "vitals" | "fluids" | "medications";

export const ROW_KINDS: readonly RowKind[] = ["injuries", "tourniquets", "vitals", "fluids", "medications"];

export const ROW_SLICE: Readonly<Record<RowKind, BoardSlice>> = {
  injuries: "body",
  tourniquets: "body",
  vitals: "vitals",
  fluids: "fluids",
  medications: "meds",
};

export type AnyBoardRow = BoardSnapshot[RowKind][number];
type Row = Record<string, unknown>;

/** Rows added or changed (with the columns the medic edited), and rows explicitly removed, by row key. */
export interface RowEdits {
  changed: Map<string, Set<string>>;
  removed: Set<string>;
}

export type PendingRows = Record<RowKind, RowEdits>;

function byKind<T>(make: () => T): Record<RowKind, T> {
  return Object.fromEntries(ROW_KINDS.map((kind) => [kind, make()])) as Record<RowKind, T>;
}

export function emptyPendingRows(): PendingRows {
  return byKind(() => ({ changed: new Map(), removed: new Set() }));
}

/** A copy of `rows` without the row keys in `skip`. */
export function copyPendingRows(rows: PendingRows, skip?: Record<RowKind, ReadonlyMap<string, unknown>>): PendingRows {
  const copy = emptyPendingRows();
  for (const kind of ROW_KINDS) {
    for (const [key, columns] of rows[kind].changed) if (!skip?.[kind].has(key)) copy[kind].changed.set(key, new Set(columns));
    for (const key of rows[kind].removed) if (!skip?.[kind].has(key)) copy[kind].removed.add(key);
  }
  return copy;
}

/**
 * How a row is matched with the stored card: a printed injury target is one row per card
 * whatever its id, a tourniquet is one per limb, and every other row is its id.
 */
export function rowKey(kind: RowKind, row: AnyBoardRow): string {
  if (kind === "tourniquets") return (row as BoardSnapshot["tourniquets"][number]).limb;
  if (kind === "injuries") {
    const injury = row as BoardSnapshot["injuries"][number];
    return injury.siteCode ? `site:${injury.siteCode}` : `row:${injury.id}`;
  }
  return row.id;
}

/** JSON with object keys sorted, so stored copies (Postgres jsonb reorders keys) compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** Equal values, whatever the key order of nested objects. */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || canonical(a) === canonical(b);
}

const sameJson = sameValue;

/** Ids and sync stamps differ between copies of a row; every other key is clinical content. */
const ROW_META = new Set(["id", "cardId", "clientUpdatedAt", "deletedAt"]);

function columnsOf(row: AnyBoardRow): string[] {
  return Object.keys(row).filter((column) => !ROW_META.has(column));
}

/** Same clinical content, column by column (key order does not matter). */
export function sameRow(a: AnyBoardRow | undefined, b: AnyBoardRow | undefined, columns?: Iterable<string>): boolean {
  if (!a || !b) return a === b;
  const keys = columns ? [...columns] : [...new Set([...columnsOf(a), ...columnsOf(b)])];
  return keys.every((column) => sameJson((a as Row)[column], (b as Row)[column]));
}

/** The stored row with the medic's edited columns on top. */
export function overlayRow<T extends AnyBoardRow>(stored: T, mine: AnyBoardRow, columns: Iterable<string>): T {
  const next = { ...stored } as Row;
  for (const column of columns) next[column] = (mine as Row)[column];
  return next as T;
}

export function findRow(snapshot: BoardSnapshot, kind: RowKind, key: string): AnyBoardRow | undefined {
  return (snapshot[kind] as readonly AnyBoardRow[]).find((row) => rowKey(kind, row) === key);
}

/** Records an edit of one row list: new rows, the columns changed in existing rows, and rows no longer in it. */
export function recordRowEdits(edits: RowEdits, kind: RowKind, before: readonly AnyBoardRow[], after: readonly AnyBoardRow[]): void {
  const previous = new Map<string, AnyBoardRow>();
  for (const row of before) if (!previous.has(rowKey(kind, row))) previous.set(rowKey(kind, row), row);
  const kept = new Set<string>();
  for (const row of after) {
    const key = rowKey(kind, row);
    kept.add(key);
    const old = previous.get(key);
    const columns = old ? columnsOf(row).filter((column) => !sameJson((old as Row)[column], (row as Row)[column])) : columnsOf(row);
    if (columns.length === 0) continue;
    const set = edits.changed.get(key) ?? new Set<string>();
    for (const column of columns) set.add(column);
    edits.changed.set(key, set);
    edits.removed.delete(key);
  }
  for (const key of previous.keys()) {
    if (kept.has(key)) continue;
    edits.removed.add(key);
    edits.changed.delete(key);
  }
}

/**
 * The stored rows with the medic's unsaved row edits on top: edited columns as shown, removed
 * rows left out, new rows added, and everything else as stored.
 */
export function rebaseRows<T extends AnyBoardRow>(kind: RowKind, shown: readonly T[], stored: readonly T[], edits: RowEdits): T[] {
  if (edits.changed.size === 0 && edits.removed.size === 0) return [...stored];
  const local = new Map<string, T>();
  for (const row of shown) if (!local.has(rowKey(kind, row))) local.set(rowKey(kind, row), row);
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const row of stored) {
    const key = rowKey(kind, row);
    // A second stored row with the same key (two devices created it) is shown as stored.
    if (seen.has(key)) {
      rows.push(row);
      continue;
    }
    seen.add(key);
    if (edits.removed.has(key)) continue;
    const columns = edits.changed.get(key);
    const mine = local.get(key);
    rows.push(columns && mine ? overlayRow(row, mine, columns) : row);
  }
  for (const [key, row] of local) if (!seen.has(key) && edits.changed.has(key)) rows.push(row);
  return rows;
}

export const DRAFT_KEY = "rowDrafts:";

/** A card field by name, as `BoardStore.currentPatch` reads it; `rowDrafts:<id>` is one row's draft. */
export function fieldValue(snapshot: BoardSnapshot, key: string): unknown {
  if (key.startsWith(DRAFT_KEY)) return snapshot.rowDrafts[key.slice(DRAFT_KEY.length)];
  const { identity, mechanism, treatments, notes, responder, rowDrafts } = snapshot;
  const sources: Record<string, unknown> = { ...identity, ...mechanism, ...treatments, notes, ...responder, rowDrafts };
  return sources[key];
}

/** The shown value saves as `theirs` (equal, or equal once trimmed like a save). */
export function sameField(mine: unknown, theirs: unknown): boolean {
  return sameJson(mine, theirs) || sameJson(normalizeText(mine), theirs);
}

/**
 * Unsaved edits another device changed too, with the other device's value (a row, or null where
 * it deleted the row). Card fields follow the shared conflict policy: most are saved last-writer-
 * wins and only reported; `held` ones and every clashing child row wait for the medic's choice.
 */
export interface Clash {
  fields: Map<string, unknown>;
  rows: Record<RowKind, Map<string, AnyBoardRow | null>>;
}

const REVIEW_FIELDS = new Set<string>(REVIEW_CARD_FIELDS);

/** A clashing card field that must not be saved until the medic chooses. */
export function isHeldField(key: string): boolean {
  return REVIEW_FIELDS.has(key);
}

function emptyClash(): Clash {
  return { fields: new Map(), rows: byKind(() => new Map()) };
}

function isEmpty(clash: Clash): boolean {
  return clash.fields.size === 0 && ROW_KINDS.every((kind) => clash.rows[kind].size === 0);
}

/**
 * The unsaved edits that `stored` changed since `base` (the card the edits were made on) to
 * something other than what the medic has. A row clashes only on a column both changed, or
 * when one side deleted a row the other changed. Null when there are none.
 */
export function findClash(fields: Iterable<string>, rows: PendingRows, base: BoardSnapshot, stored: BoardSnapshot, local: BoardSnapshot): Clash | null {
  const clash = emptyClash();
  for (const key of fields) {
    const theirs = fieldValue(stored, key);
    if (sameJson(fieldValue(base, key), theirs) || sameField(fieldValue(local, key), theirs)) continue;
    clash.fields.set(key, theirs);
  }
  for (const kind of ROW_KINDS) {
    for (const [key, columns] of rows[kind].changed) {
      const [was, theirs, mine] = [findRow(base, kind, key), findRow(stored, kind, key), findRow(local, kind, key)];
      if (sameRow(was, theirs)) continue;
      const clashes = !theirs || !was ? !sameRow(mine, theirs) : !sameRow(was, theirs, columns) && !sameRow(mine, theirs, columns);
      if (clashes) clash.rows[kind].set(key, theirs ?? null);
    }
    for (const key of rows[kind].removed) {
      const theirs = findRow(stored, kind, key);
      if (theirs && !sameRow(findRow(base, kind, key), theirs)) clash.rows[kind].set(key, theirs);
    }
  }
  return isEmpty(clash) ? null : clash;
}

/** Both clashes in one; the later one's values win. */
export function mergeClash(earlier: Clash | null, later: Clash | null): Clash | null {
  if (!earlier || !later) return earlier ?? later;
  return {
    fields: new Map([...earlier.fields, ...later.fields]),
    rows: Object.fromEntries(ROW_KINDS.map((kind) => [kind, new Map([...earlier.rows[kind], ...later.rows[kind]])])) as Clash["rows"],
  };
}

/**
 * The clash after a newer stored card `next` arrived: a value the other device changed again is
 * updated, and an entry is dropped once the stored value is the medic's, or once a saved (no
 * longer dirty) field was replaced by a newer edit, which now shows. Null when nothing is left.
 */
export function refreshClash(clash: Clash, base: BoardSnapshot, next: BoardSnapshot, local: BoardSnapshot, dirtyKeys: ReadonlySet<string>): Clash | null {
  const fresh: Clash = { fields: new Map(clash.fields), rows: byKind(() => new Map()) };
  for (const kind of ROW_KINDS) fresh.rows[kind] = new Map(clash.rows[kind]);
  for (const key of clash.fields.keys()) {
    const theirs = fieldValue(next, key);
    if (sameJson(theirs, fieldValue(base, key))) continue;
    if (!dirtyKeys.has(key) || sameField(fieldValue(local, key), theirs)) fresh.fields.delete(key);
    else fresh.fields.set(key, theirs);
  }
  for (const kind of ROW_KINDS) {
    for (const key of clash.rows[kind].keys()) {
      const theirs = findRow(next, kind, key);
      if (sameRow(theirs, findRow(base, kind, key))) continue;
      if (sameRow(findRow(local, kind, key), theirs)) fresh.rows[kind].delete(key);
      else fresh.rows[kind].set(key, theirs ?? null);
    }
  }
  return isEmpty(fresh) ? null : fresh;
}

/**
 * The other version's values placed into `snapshot`, for "Load updated card". Only the clashing
 * fields and rows change; every other edit stays.
 */
export function takeRemote(snapshot: BoardSnapshot, clash: Clash): BoardSnapshot {
  const next: BoardSnapshot = { ...snapshot };
  for (const [key, value] of clash.fields) {
    if (key.startsWith(DRAFT_KEY)) {
      const rowDrafts = { ...next.rowDrafts };
      if (value === undefined) delete rowDrafts[key.slice(DRAFT_KEY.length)];
      else rowDrafts[key.slice(DRAFT_KEY.length)] = value as BoardSnapshot["rowDrafts"][string];
      next.rowDrafts = rowDrafts;
    } else if (key === "notes") next.notes = value as BoardSnapshot["notes"];
    else {
      for (const section of ["identity", "mechanism", "treatments", "responder"] as const) {
        if (key in next[section]) next[section] = { ...next[section], [key]: value } as never;
      }
    }
  }
  for (const kind of ROW_KINDS) {
    const theirs = clash.rows[kind];
    if (theirs.size === 0) continue;
    const rows = (next[kind] as AnyBoardRow[]).filter((row) => !theirs.has(rowKey(kind, row)));
    for (const row of theirs.values()) if (row) rows.push(row);
    next[kind] = rows as never;
  }
  return next;
}
