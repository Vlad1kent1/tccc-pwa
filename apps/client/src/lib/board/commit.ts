import Dexie from "dexie";
import type { CardPatch, ChildEntity } from "@tccc/shared";
import { isStorableChild, type CasualtyRepo, type ChildInput, type LocalCasualtyCard } from "@/lib/db";
import {
  copyPendingRows,
  DRAFT_KEY,
  findClash,
  isHeldField,
  mergeClash,
  overlayRow,
  rowKey,
  ROW_KINDS,
  ROW_SLICE,
  sameValue,
  type AnyBoardRow,
  type Clash,
  type PendingRows,
  type RowKind,
} from "./pending";
import { snapshotFromCard, type BoardSlice, type BoardSnapshot } from "./snapshot";

type Unstored = Record<RowKind, Set<string>>;

/** What one save writes: card fields, child row edits, and the row drafts (by row id) to merge into the stored ones. */
export interface BoardEdits {
  patch: CardPatch;
  rows: PendingRows;
  drafts: ReadonlySet<string>;
}

/**
 * `skipped` lists sections with a row that could not be stored, and `unstored` those rows by key.
 * `clash` lists edits another device changed too since `base`: clashing rows and held fields were
 * not written; other clashing fields were (the later edit wins). Every other edit was written.
 * `before` and `stored` are the card as this write found and left it.
 */
export type CommitResult =
  | { status: "aborted" }
  | {
      status: "saved";
      clientUpdatedAt: string;
      skipped: BoardSlice[];
      unstored: Unstored;
      clash: Clash | null;
      before: BoardSnapshot;
      stored: BoardSnapshot;
    };

interface RowContext {
  repo: CasualtyRepo;
  rows: PendingRows;
  isCurrent: () => boolean;
  skipped: Set<BoardSlice>;
  unstored: Unstored;
}

/** Rows that fail validation are left out and reported, so they do not roll back the rest of the save. */
async function upsertIfStorable<E extends ChildEntity>(
  ctx: RowContext,
  cardId: string,
  entity: E,
  input: ChildInput<E>,
  slice: BoardSlice,
  kind: RowKind,
  key: string,
): Promise<void> {
  if (!isStorableChild(cardId, entity, input)) {
    ctx.skipped.add(slice);
    ctx.unstored[kind].add(key);
    return;
  }
  await ctx.repo.upsertChild(cardId, entity, input);
}

const sameJson = sameValue;

function ensure(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Dexie.AbortError();
}

function active<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt == null);
}

function emptyUnstored(): Unstored {
  return Object.fromEntries(ROW_KINDS.map((kind) => [kind, new Set<string>()])) as Unstored;
}

/**
 * Writes the dirty slices of one board edit in a single Dexie transaction: the fields in the
 * patch, and only the child rows and columns the medic changed or removed. A stored row or
 * column the medic did not touch is left as it is, so rows and edits from another device
 * survive (P1-003). Child rows are matched by key. A newer edit aborts this transaction.
 * `base` is the card the edits were made on; null skips the clash check. `held` is the clash
 * already known when the save runs: its rows and held fields are not written either.
 */
export async function commitBoard(
  repo: CasualtyRepo,
  cardId: string,
  draft: BoardSnapshot,
  dirty: ReadonlySet<BoardSlice>,
  edits: BoardEdits,
  base: BoardSnapshot | null,
  held: Clash | null,
  isCurrent: () => boolean,
): Promise<CommitResult> {
  if (!isCurrent()) return { status: "aborted" };
  const pending = pendingIn(edits.rows, dirty);
  const ctx: RowContext = { repo, rows: pending, isCurrent, skipped: new Set(), unstored: emptyUnstored() };
  let clash: Clash | null = null;
  try {
    const { before, after } = await repo.readWrite(async () => {
      ctx.skipped.clear();
      ctx.unstored = emptyUnstored();
      ensure(isCurrent);
      const card = await requireCard(repo, cardId);
      const fieldKeys = [...Object.keys(edits.patch).filter((key) => key !== "rowDrafts"), ...[...edits.drafts].map((id) => DRAFT_KEY + id)];
      clash = base ? findClash(fieldKeys, pending, base, snapshotFromCard(card), draft) : null;
      // Clashing rows and held fields wait for the medic's choice (shared conflict policy),
      // including those found after this save was queued.
      const withheld = mergeClash(held, clash);
      ctx.rows = withheld ? copyPendingRows(pending, withheld.rows) : pending;
      const fields = changedFields(card, withRowDrafts(withoutHeld(edits.patch, withheld), card, edits.drafts));
      if (Object.keys(fields).length > 0) {
        ensure(isCurrent);
        await repo.updateFields(card.id, fields);
      }
      if (dirty.has("body")) {
        ensure(isCurrent);
        await syncInjuries(ctx, card, draft);
        await syncTourniquets(ctx, await requireCard(repo, cardId), draft);
      }
      if (dirty.has("vitals")) {
        ensure(isCurrent);
        await syncVitals(ctx, await requireCard(repo, cardId), draft);
      }
      if (dirty.has("fluids")) {
        ensure(isCurrent);
        await syncFluids(ctx, await requireCard(repo, cardId), draft);
      }
      if (dirty.has("meds")) {
        ensure(isCurrent);
        await syncMeds(ctx, await requireCard(repo, cardId), draft);
      }
      return { before: card, after: await requireCard(repo, cardId) };
    });
    return {
      status: "saved",
      clientUpdatedAt: after.clientUpdatedAt,
      skipped: [...ctx.skipped],
      unstored: ctx.unstored,
      clash,
      before: snapshotFromCard(before),
      stored: snapshotFromCard(after),
    };
  } catch (error) {
    if (error instanceof Dexie.AbortError) return { status: "aborted" };
    throw error;
  }
}

/** The row edits of the dirty slices only; the others are not written by this commit. */
function pendingIn(rows: PendingRows, dirty: ReadonlySet<BoardSlice>): PendingRows {
  const copy = copyPendingRows(rows);
  for (const kind of ROW_KINDS) if (!dirty.has(ROW_SLICE[kind])) copy[kind] = { changed: new Map(), removed: new Set() };
  return copy;
}

function withoutHeld(patch: CardPatch, clash: Clash | null): CardPatch {
  if (!clash) return patch;
  return Object.fromEntries(Object.entries(patch).filter(([key]) => !(clash!.fields.has(key) && isHeldField(key)))) as CardPatch;
}

/** The stored row drafts with this save's drafts (by row id) on top, so another device's drafts stay. */
function withRowDrafts(patch: CardPatch, card: LocalCasualtyCard, ids: ReadonlySet<string>): CardPatch {
  if (!patch.rowDrafts) return patch;
  const merged = { ...card.rowDrafts };
  for (const id of ids) {
    const entry = patch.rowDrafts[id];
    if (entry) merged[id] = entry;
    else delete merged[id];
  }
  return { ...patch, rowDrafts: merged };
}

async function requireCard(repo: CasualtyRepo, cardId: string): Promise<LocalCasualtyCard> {
  const card = await repo.getById(cardId);
  if (!card || card.deletedAt) throw new Dexie.AbortError();
  return card;
}

function changedFields(card: LocalCasualtyCard, patch: CardPatch): CardPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => !sameJson(card[key as keyof CardPatch], value))) as CardPatch;
}

/** Deletes the stored rows of `kind` that the medic removed; no other row is deleted. */
async function deleteRemoved<T extends { id: string; deletedAt: string | null }>(
  ctx: RowContext,
  kind: RowKind,
  stored: T[],
  remove: (row: T) => Promise<unknown>,
): Promise<void> {
  const { removed } = ctx.rows[kind];
  if (removed.size === 0) return;
  for (const row of active(stored)) {
    ensure(ctx.isCurrent);
    if (removed.has(rowKey(kind, row as unknown as AnyBoardRow))) await remove(row);
  }
}

/**
 * The row to write: the stored row with the edited columns on top, or the draft row when nothing
 * active is stored under its key. Null when the edited columns already hold those values.
 */
function rowToWrite<T extends AnyBoardRow>(stored: T | undefined, draft: T, columns: ReadonlySet<string>): T | null {
  if (!stored) return draft;
  const next = overlayRow(stored, draft, columns);
  return [...columns].every((column) => sameJson((stored as Record<string, unknown>)[column], (next as Record<string, unknown>)[column])) ? null : next;
}

/**
 * A printed target is one row per card, whatever its id; the sheet may create it
 * again after it was cleared. An X placed freely on the figure is its row.
 */
async function syncInjuries(ctx: RowContext, card: LocalCasualtyCard, draft: BoardSnapshot): Promise<void> {
  const { changed } = ctx.rows.injuries;
  await deleteRemoved(ctx, "injuries", card.injurySites, (row) => ctx.repo.deleteChild(card.id, "injurySite", row.id));
  for (const row of draft.injuries) {
    ensure(ctx.isCurrent);
    const key = rowKey("injuries", row);
    const columns = changed.get(key);
    if (!columns) continue;
    // An active row for the key first: a deleted one may share a site with another device's live row.
    const existing =
      active(card.injurySites).find((item) => rowKey("injuries", item) === key) ?? card.injurySites.find((item) => rowKey("injuries", item) === key);
    const next = rowToWrite(existing && !existing.deletedAt ? existing : undefined, row, columns);
    if (!next) continue;
    await upsertIfStorable(
      ctx,
      card.id,
      "injurySite",
      { id: existing?.id ?? row.id, region: next.region, view: next.view, x: next.x, y: next.y, siteCode: next.siteCode, description: next.description },
      "body",
      "injuries",
      key,
    );
  }
}

async function syncTourniquets(ctx: RowContext, card: LocalCasualtyCard, draft: BoardSnapshot): Promise<void> {
  const { changed } = ctx.rows.tourniquets;
  await deleteRemoved(ctx, "tourniquets", card.tourniquets, (row) => ctx.repo.deleteChild(card.id, "tourniquet", row.id));
  for (const row of draft.tourniquets) {
    ensure(ctx.isCurrent);
    const columns = changed.get(row.limb);
    if (!columns) continue;
    const next = rowToWrite(active(card.tourniquets).find((item) => item.limb === row.limb), row, columns);
    if (!next) continue;
    await upsertIfStorable(ctx, card.id, "tourniquet", { limb: next.limb, type: next.type, appliedAt: next.appliedAt }, "body", "tourniquets", row.limb);
  }
}

async function syncVitals(ctx: RowContext, card: LocalCasualtyCard, draft: BoardSnapshot): Promise<void> {
  const { changed } = ctx.rows.vitals;
  await deleteRemoved(ctx, "vitals", card.vitalSigns, (row) => ctx.repo.deleteChild(card.id, "vitalSigns", row.id));
  for (const row of draft.vitals) {
    ensure(ctx.isCurrent);
    const columns = changed.get(row.id);
    if (!columns) continue;
    const next = rowToWrite(active(card.vitalSigns).find((item) => item.id === row.id), row, columns);
    if (!next) continue;
    await upsertIfStorable(
      ctx,
      card.id,
      "vitalSigns",
      {
        id: row.id,
        measuredAt: next.measuredAt,
        pulseRate: next.pulseRate,
        pulseLocation: next.pulseLocation,
        systolic: next.systolic,
        diastolic: next.diastolic,
        respiratoryRate: next.respiratoryRate,
        spo2: next.spo2,
        avpu: next.avpu,
        painScale: next.painScale,
      },
      "vitals",
      "vitals",
      row.id,
    );
  }
}

async function syncFluids(ctx: RowContext, card: LocalCasualtyCard, draft: BoardSnapshot): Promise<void> {
  const { changed } = ctx.rows.fluids;
  await deleteRemoved(ctx, "fluids", card.fluids, (row) => ctx.repo.deleteChild(card.id, "fluid", row.id));
  for (const row of draft.fluids) {
    ensure(ctx.isCurrent);
    const columns = changed.get(row.id);
    if (!columns) continue;
    const next = rowToWrite(active(card.fluids).find((item) => item.id === row.id), row, columns);
    if (!next) continue;
    const input = {
      id: row.id,
      kind: next.kind,
      name: next.name,
      volumeMl: next.volumeMl,
      route: next.route,
      administeredAt: next.administeredAt,
    } as ChildInput<"fluid">;
    await upsertIfStorable(ctx, card.id, "fluid", input, "fluids", "fluids", row.id);
  }
}

async function syncMeds(ctx: RowContext, card: LocalCasualtyCard, draft: BoardSnapshot): Promise<void> {
  const { changed } = ctx.rows.medications;
  await deleteRemoved(ctx, "medications", card.medications, (row) => ctx.repo.deleteChild(card.id, "medication", row.id));
  for (const row of draft.medications) {
    ensure(ctx.isCurrent);
    const columns = changed.get(row.id);
    if (!columns) continue;
    const next = rowToWrite(active(card.medications).find((item) => item.id === row.id), row, columns);
    if (!next) continue;
    const input = {
      id: row.id,
      category: next.category,
      name: next.name,
      dose: next.dose,
      route: next.route,
      administeredAt: next.administeredAt,
    } as ChildInput<"medication">;
    await upsertIfStorable(ctx, card.id, "medication", input, "meds", "medications", row.id);
  }
}
