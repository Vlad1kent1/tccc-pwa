/* eslint-disable max-lines -- BoardStore god class, split tracked in P2-023 (CODE_REVIEW.md) */
"use client";

import {
  Limb,
  compareHlc,
  newId,
  type BodyRegion,
  type BodyView as BodyViewName,
  type CardField,
  type CardPatch,
  type MechanismOfInjury,
} from "@tccc/shared";
import { db, getResponderProfile, type CasualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import { cleanCardPatch, type CleanPatch } from "@/lib/forms/card-patch";
import { reportSaveFailed } from "@/lib/forms/save-status";
import { isUnfinishedTime } from "@/lib/forms/time";
import { responderPatch } from "@/lib/forms/values";
import { networkNowIso } from "@/lib/network-clock";
import { layoutPaper, pinPaperRow, reconcileTreatments, regionAt, unpinPaperRow } from "@tccc/dd1380";
import { commitBoard } from "../commit";
import {
  copyPendingRows,
  DRAFT_KEY,
  emptyPendingRows,
  findClash,
  isHeldField,
  mergeClash,
  rebaseRows,
  recordRowEdits,
  refreshClash,
  ROW_KINDS,
  ROW_SLICE,
  sameValue,
  takeRemote,
  type AnyBoardRow,
  type Clash,
  type PendingRows,
} from "../pending";
import {
  emptySnapshot,
  snapshotFromCard,
  type BoardSlice,
  type BoardSnapshot,
  type BoardTreatments,
  type TreatmentListKey,
} from "../snapshot";
import { clamp, hasDraftContent, keepTyped, limbForRegion, sameJson, sliceOfField, upsertById } from "./helpers";
import { publishInvalidFields } from "./live";

export type { BoardSlice, BoardSnapshot };

type When = "debounce" | "now";

/** The board sections a time box belongs to, as the save banner names them. */
export type TimeBoxSlice = Extract<BoardSlice, "body" | "vitals" | "fluids" | "meds">;

const DEBOUNCE_MS = 400;
const MARK_RADIUS = 0.04;
const LAST4_FIELDS = new Set<string>(["casualtyLast4", "responderLast4"]);

interface SaveJob {
  epoch: number;
  draft: BoardSnapshot;
  slices: Set<BoardSlice>;
  patch: CardPatch;
  /** The child rows changed or removed, as recorded when the job was queued, without held ones. */
  rows: PendingRows;
  /** Row ids whose `rowDrafts` entry this job saves. */
  drafts: Set<string>;
  /** Clashing fields left out of `patch` until the medic chooses (shared conflict policy). */
  held: CardField[];
  /** Dirty fields left out of `patch` because their value is invalid. */
  invalid: CardField[];
  /** Dirty fields left out of `patch` because they are still being typed (a partial last 4). */
  pending: CardField[];
  forceCreate: boolean;
}

/** What a store needs from outside. The registry passes the app's; tests pass their own. */
export interface BoardDeps {
  repo: CasualtyRepo;
  /** A draft store created its card. */
  onCreated: (store: BoardStore, cardId: string) => void;
  /** A save finished or failed; the save banner and garbage collection re-check. */
  onSettled: (store: BoardStore) => void;
}

/**
 * All edits of one casualty card: the tactical board, the DD1380 sheet, and the
 * printed tables write here, and only here. One debounce timer and one job queue
 * per card, saved through `commitBoard`, so two editors can never race each other.
 * A store for a new casualty starts without a card id and creates the card on the
 * first edit with content.
 */
export class BoardStore {
  private snapshot: BoardSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly idListeners = new Set<(id: string) => void>();
  private readonly dirty = new Set<BoardSlice>();
  /** Card fields edited and not yet saved. A save removes the ones it stored (P1-003). */
  private readonly dirtyKeys = new Set<string>();
  /** Child rows edited or removed and not yet saved: a save writes only these (P1-003). */
  private readonly pendingRows = emptyPendingRows();
  /** The stored card the unsaved edits were made on, to tell another device's changes from them. */
  private base: BoardSnapshot;
  /** Unsaved edits another device changed too, until the medic keeps theirs or loads the update. */
  private clash: Clash | null = null;
  private readonly jobs: SaveJob[] = [];
  private epoch = 0;
  private saving = false;
  /** `clientUpdatedAt` of the card as this store last wrote or adopted it. */
  private acked = "";
  private queuedCard: LocalCasualtyCard | null = null;
  private creating: Promise<LocalCasualtyCard> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drainPromise: Promise<boolean> | null = null;
  /** The last write failed. The edits are still dirty here and are retried by the next flush. */
  failed = false;
  /** Fields and sections left out of the last save, for the save banner. */
  invalid: readonly string[] = [];
  /**
   * Time boxes whose text lives only on screen (the tourniquet time), left with text that is
   * not a complete time, by box key. Row time boxes are judged from `rowDrafts` instead.
   */
  private unfinishedTimes = new Map<string, TimeBoxSlice>();
  /** The row time box being typed into. It is not flagged until it is left. */
  private focusedTimeBox: string | null = null;
  /** The stored tourniquet type when its type box was focused, by limb. */
  private readonly typeAtFocus = new Map<Limb, string>();
  /** Mounted screens using this store. The registry drops it at zero once its saves settle. */
  refs = 0;

  constructor(
    private readonly deps: BoardDeps,
    card: LocalCasualtyCard | null,
  ) {
    this.snapshot = card ? snapshotFromCard(card) : emptySnapshot(null);
    this.base = this.snapshot;
    this.acked = card?.clientUpdatedAt ?? "";
  }

  get cardId(): string | null {
    return this.snapshot.cardId;
  }

  getSnapshot = (): BoardSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeId = (listener: (id: string) => void): (() => void) => {
    this.idListeners.add(listener);
    return () => this.idListeners.delete(listener);
  };

  /**
   * No timer, no queued or running save, no card being created, the last save did not fail, and
   * no clashing edit waits for the medic's choice (it lives only in this store until then).
   */
  isSettled(): boolean {
    return (
      this.timer === undefined && this.jobs.length === 0 && !this.drainPromise && !this.creating && !this.failed && this.heldNames().length === 0
    );
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
    publishInvalidFields();
  }

  /**
   * What the save banner lists for this store: invalid fields, skipped sections, sections with an
   * unfinished time box, and clashing edits held until the medic chooses.
   */
  reportedInvalid(): string[] {
    const rowTimes = Object.keys(this.snapshot.rowDrafts).map((id) => this.unfinishedRowTime(id));
    return [...new Set([...this.invalid, ...this.unfinishedTimes.values(), ...rowTimes.filter((slice) => slice != null), ...this.heldNames()])];
  }

  /** Held clashing edits, as the save banner names them: a held field, or the section of a held row. */
  private heldNames(): string[] {
    const clash = this.clash;
    if (!clash) return [];
    const fields = [...clash.fields.keys()].filter(isHeldField);
    return [...fields, ...ROW_KINDS.filter((kind) => clash.rows[kind].size > 0).map((kind) => ROW_SLICE[kind])];
  }

  /** The sections of held clashing edits; they stay unsaved until the medic chooses. */
  private heldSlices(): BoardSlice[] {
    const clash = this.clash;
    if (!clash) return [];
    const fields = [...clash.fields.keys()].filter(isHeldField).map(sliceOfField);
    return [...fields, ...ROW_KINDS.filter((kind) => clash.rows[kind].size > 0).map((kind) => ROW_SLICE[kind])];
  }

  /**
   * The section of a row whose time box shows text that is not a complete time, so what it
   * shows is not the stored time (P0-001). Judged from the persisted `rowDrafts`, so the flag
   * survives a reload or another device, and goes away with the row. The box being typed
   * into is not flagged until it is left.
   */
  private unfinishedRowTime(id: string): TimeBoxSlice | null {
    if (id === this.focusedTimeBox) return null;
    const { rowDrafts, vitals, fluids, medications } = this.snapshot;
    if (!isUnfinishedTime(rowDrafts[id]?.time ?? "")) return null;
    if (vitals.some((row) => row.id === id)) return "vitals";
    if (fluids.some((row) => row.id === id)) return "fluids";
    if (medications.some((row) => row.id === id)) return "meds";
    return null;
  }

  isTimeBoxUnfinished = (key: string): boolean => this.unfinishedTimes.has(key) || this.unfinishedRowTime(key) != null;

  /** A row time box gained (`id`) or lost (`null`) focus. */
  focusTimeBox = (id: string | null): void => {
    if (id === this.focusedTimeBox) return;
    this.focusedTimeBox = id;
    this.emit();
  };

  /**
   * Re-checks a time box whose text is not stored (the tourniquet time). On blur (`typing`
   * false) text that is not a complete time is flagged. While typing, a flag is only
   * cleared, never raised, so a half-typed time is not flagged mid-keystroke.
   */
  checkTimeBox = (key: string, slice: TimeBoxSlice, text: string, typing = false): void => {
    const unfinished = isUnfinishedTime(text);
    if (typing && unfinished) return;
    if (unfinished === this.unfinishedTimes.has(key)) return;
    if (unfinished) this.unfinishedTimes.set(key, slice);
    else this.unfinishedTimes.delete(key);
    this.emit();
  };

  /** Drops the on-screen time box flags, once the screen holding the boxes is gone. The caller republishes. */
  forgetTimeBoxes(): void {
    this.unfinishedTimes.clear();
    this.focusedTimeBox = null;
  }

  // ── Card updates from Dexie ──────────────────────────────────────────────

  /** The live card from Dexie. A card other than this store's own is ignored. */
  hydrate = (card: LocalCasualtyCard): void => {
    if (card.id !== this.snapshot.cardId) return;
    if (this.saving) {
      if (!this.queuedCard || compareHlc(card.clientUpdatedAt, this.queuedCard.clientUpdatedAt) >= 0) this.queuedCard = card;
      return;
    }
    this.applyHydrate(card);
  };

  /**
   * Adopts a newer stored card under the unsaved edits, which stay on screen and are saved over it
   * (P1-003). Unsaved edits it changed too raise the remote banner until the medic chooses.
   */
  private applyHydrate(card: LocalCasualtyCard): void {
    if (this.acked && compareHlc(card.clientUpdatedAt, this.acked) < 0) return;
    const next = snapshotFromCard(card);
    if (this.clash) this.clash = refreshClash(this.clash, this.base, next, this.snapshot, this.dirtyKeys);
    this.noteClash(findClash(this.dirtyKeys, this.pendingRows, this.base, next, this.snapshot));
    this.acked = card.clientUpdatedAt;
    this.base = next;
    this.snapshot = this.rebase(next);
    this.emit();
  }

  private noteClash(clash: Clash | null): void {
    this.clash = mergeClash(this.clash, clash);
  }

  /** The stored card with the unsaved field and row edits on top. */
  private rebase(next: BoardSnapshot): BoardSnapshot {
    const current = this.snapshot;
    // Each value keeps its old object when nothing in it changed: every save re-reads the card,
    // and new objects would re-render every block and the injury figures each time. Text that
    // saves to the stored value (a trailing space the save trimmed) stays as typed (P1-007).
    const section = <K extends "identity" | "mechanism" | "treatments" | "responder">(key: K): BoardSnapshot[K] => {
      const merged = keepTyped(current[key], next[key]);
      const mine = Object.keys(next[key]).filter((field) => this.dirtyKeys.has(field));
      if (mine.length === 0) return merged;
      const shown = current[key] as Record<string, unknown>;
      const rebased = { ...merged, ...Object.fromEntries(mine.map((field) => [field, shown[field]])) } as BoardSnapshot[K];
      return sameJson(rebased, current[key]) ? current[key] : rebased;
    };
    const notes = this.dirtyKeys.has("notes") ? current.notes : keepTyped(current.notes, next.notes);
    // Row drafts merge by row id: another device's drafts stay next to the unsaved ones.
    const draftIds = [...this.dirtyKeys].filter((key) => key.startsWith(DRAFT_KEY)).map((key) => key.slice(DRAFT_KEY.length));
    const rowDrafts = (): BoardSnapshot["rowDrafts"] => {
      if (draftIds.length === 0) return keepTyped(current.rowDrafts, next.rowDrafts);
      const merged = { ...next.rowDrafts };
      for (const id of draftIds) {
        const entry = current.rowDrafts[id];
        if (entry) merged[id] = entry;
        else delete merged[id];
      }
      return sameJson(merged, current.rowDrafts) ? current.rowDrafts : merged;
    };
    const rows = <K extends (typeof ROW_KINDS)[number]>(kind: K): BoardSnapshot[K] => {
      const rebased = rebaseRows(kind, current[kind] as readonly AnyBoardRow[], next[kind] as readonly AnyBoardRow[], this.pendingRows[kind]);
      return (sameJson(rebased, current[kind]) ? current[kind] : rebased) as BoardSnapshot[K];
    };
    const merged: BoardSnapshot = {
      ...next,
      remote: this.clash != null,
      identity: section("identity"),
      mechanism: section("mechanism"),
      injuries: rows("injuries"),
      tourniquets: rows("tourniquets"),
      treatments: section("treatments"),
      vitals: rows("vitals"),
      fluids: rows("fluids"),
      medications: rows("medications"),
      notes,
      responder: section("responder"),
      rowDrafts: rowDrafts(),
      sheetText: current.sheetText,
    };
    // Columns keep their rows across updates; only `resetPaperLayout` re-sorts them.
    return { ...merged, paper: layoutPaper(merged, current.paper) };
  }

  /** "Keep my edits": the medic's values stay, and held ones are now saved over the other version. */
  keepEdits = (): void => {
    this.clash = null;
    this.snapshot = { ...this.snapshot, remote: false };
    // A new epoch, so the next save is a new job that includes the edits held until now.
    this.epoch += 1;
    this.emit();
    void this.flush();
  };

  /** "Load updated card": the other version's values replace the clashing edits, and are saved. */
  loadUpdate = (): void => {
    const clash = this.clash;
    if (!clash) return;
    this.clash = null;
    const fields = [...clash.fields.keys()];
    const slices = new Set<BoardSlice>(fields.map(sliceOfField));
    for (const kind of ROW_KINDS) if (clash.rows[kind].size > 0) slices.add(ROW_SLICE[kind]);
    this.apply(slices, { ...takeRemote(this.snapshot, clash), remote: false }, fields, "now");
  };

  // ── Edits ────────────────────────────────────────────────────────────────

  private touch(slice: BoardSlice, partial: Partial<BoardSnapshot>, keys: readonly string[], when: When): void {
    this.apply([slice], partial, keys, when);
  }

  /** Records an edit: its sections, card fields and child rows become unsaved, and a save is scheduled. */
  private apply(slices: Iterable<BoardSlice>, partial: Partial<BoardSnapshot>, keys: readonly string[], when: When): void {
    this.epoch += 1;
    for (const slice of slices) this.dirty.add(slice);
    for (const key of keys) this.dirtyKeys.add(key);
    for (const kind of ROW_KINDS) {
      const rows = partial[kind] as readonly AnyBoardRow[] | undefined;
      if (rows && rows !== this.snapshot[kind]) recordRowEdits(this.pendingRows[kind], kind, this.snapshot[kind], rows);
    }
    this.snapshot = { ...this.snapshot, ...partial };
    this.emit();
    this.clearTimer();
    if (when === "now") {
      void this.flush();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private clearTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  editIdentity = (patch: Partial<BoardSnapshot["identity"]>, when: When = "debounce"): void => {
    const immediate = !this.snapshot.cardId && Boolean(patch.lastName);
    this.touch("identity", { identity: { ...this.snapshot.identity, ...patch } }, Object.keys(patch), immediate ? "now" : when);
  };

  editMechanism = (patch: Partial<BoardSnapshot["mechanism"]>, when: When = "now"): void => {
    this.touch("mechanism", { mechanism: { ...this.snapshot.mechanism, ...patch } }, Object.keys(patch), when);
  };

  toggleMechanism = (item: MechanismOfInjury): void => {
    const { mechanisms, mechanismOther } = this.snapshot.mechanism;
    const has = mechanisms.includes(item);
    this.editMechanism({
      mechanisms: has ? mechanisms.filter((entry) => entry !== item) : [...mechanisms, item],
      mechanismOther: item === "OTHER" && has ? null : mechanismOther,
    });
  };

  /** Checkboxes save at once; pass `"debounce"` for typed text such as a Type column. */
  editTreatments = (patch: Partial<BoardTreatments>, when: When = "now"): void => {
    const before = this.snapshot.treatments;
    const next = reconcileTreatments(before, { ...before, ...patch });
    const keys = (Object.keys(next) as (keyof BoardTreatments)[]).filter((key) => next[key] !== before[key]);
    this.touch("treatments", { treatments: next }, keys, when);
  };

  toggleTreatment = <K extends TreatmentListKey>(key: K, item: BoardTreatments[K][number]): void => {
    const current = this.snapshot.treatments[key] as string[];
    const next = current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item];
    this.editTreatments({ [key]: next } as Partial<BoardTreatments>);
  };

  /**
   * Unfinished vitals, fluid, and medication cell text. Saved and synced like any card field, but
   * tracked per row id, so a save merges it into the stored drafts of other rows (P1-003).
   */
  editRowDrafts = (rowDrafts: BoardSnapshot["rowDrafts"]): void => {
    const before = this.snapshot.rowDrafts;
    const ids = [...new Set([...Object.keys(before), ...Object.keys(rowDrafts)])].filter((id) => !sameValue(before[id], rowDrafts[id]));
    this.touch("drafts", { rowDrafts }, ids.map((id) => DRAFT_KEY + id), "debounce");
  };

  editNotes = (notes: string): void => {
    this.touch("notes", { notes: notes === "" ? null : notes }, ["notes"], "debounce");
  };

  editResponder = (patch: Partial<BoardSnapshot["responder"]>): void => {
    this.touch("responder", { responder: { ...this.snapshot.responder, ...patch } }, Object.keys(patch), "debounce");
  };

  autoFillResponder = async (): Promise<void> => {
    const patch = responderPatch(await getResponderProfile(db));
    const next: Partial<BoardSnapshot["responder"]> = {};
    if (patch.responderName) next.responderName = patch.responderName;
    if (patch.responderLast4) next.responderLast4 = patch.responderLast4;
    if (Object.keys(next).length === 0) return;
    this.editResponder(next);
    void this.flush();
  };

  /** Places a mark at a point on the figure, or removes the mark already under that point. */
  placeInjury = (view: BodyViewName, x: number, y: number): void => {
    const nx = clamp(x);
    const ny = clamp(y);
    const { injuries } = this.snapshot;
    const near = injuries.find(
      (row) => row.view === view && row.x != null && row.y != null && (row.x - nx) ** 2 + (row.y - ny) ** 2 <= MARK_RADIUS ** 2,
    );
    if (near) {
      this.editInjuries(injuries.filter((row) => row.id !== near.id));
      return;
    }
    const id = newId();
    this.editInjuries([
      ...injuries,
      {
        id,
        region: regionAt(view, nx, ny),
        view,
        x: nx,
        y: ny,
        siteCode: null,
        description: null,
        clientUpdatedAt: "",
        deletedAt: null,
      },
    ]);
  };

  removeInjury = (id: string): void => {
    this.editInjuries(this.snapshot.injuries.filter((row) => row.id !== id));
  };

  editInjuries = (injuries: BoardSnapshot["injuries"]): void => {
    this.touch("body", { injuries }, [], "now");
  };

  setTourniquet = (region: BodyRegion, type: string, appliedAt?: string): void => {
    const limb = limbForRegion(region);
    if (limb) this.setLimbTourniquet(limb, type, appliedAt);
  };

  /**
   * Sets the limb's tourniquet type. Without `appliedAt` an existing one keeps its time and a new
   * one is stamped now. A blank type changes nothing: it is a type being corrected, and only
   * `removeTourniquet` deletes a tourniquet (P0-002).
   */
  setLimbTourniquet = (limb: Limb, type: string, appliedAt?: string): void => {
    const trimmed = type.trim().slice(0, 50);
    if (!trimmed) return;
    this.touch("body", { tourniquets: this.upsertTourniquet(limb, trimmed, appliedAt) }, [], "debounce");
  };

  /** A tourniquet type box gained focus: its stored type is what a blank box is restored to. */
  focusTourniquetType = (limb: Limb): void => {
    const type = this.snapshot.tourniquets.find((row) => row.limb === limb)?.type;
    if (type) this.typeAtFocus.set(limb, type);
    else this.typeAtFocus.delete(limb);
  };

  /**
   * A tourniquet type box lost focus showing `text`. Left blank while the limb has a tourniquet,
   * the type from when the box was focused is put back and saved, not a partial type an autosave
   * stored while backspacing (P0-002). True when the box was blank, so it can show the Remove hint.
   */
  leaveTourniquetType = (limb: Limb, text: string): boolean => {
    const focused = this.typeAtFocus.get(limb);
    this.typeAtFocus.delete(limb);
    if (text.trim()) return false;
    const row = this.snapshot.tourniquets.find((item) => item.limb === limb);
    if (!row) return false;
    if (focused && focused !== row.type) this.setLimbTourniquet(limb, focused);
    return true;
  };

  /** The explicit Remove action: the only way a tourniquet is deleted. */
  removeTourniquet = (limb: Limb): void => {
    if (!this.snapshot.tourniquets.some((row) => row.limb === limb)) return;
    this.touch("body", { tourniquets: this.snapshot.tourniquets.filter((row) => row.limb !== limb) }, [], "now");
  };

  setTourniquetTime = (region: BodyRegion, appliedAt: string): void => {
    const limb = limbForRegion(region);
    if (!limb || !this.snapshot.tourniquets.some((row) => row.limb === limb)) return;
    const tourniquets = this.snapshot.tourniquets.map((row) => (row.limb === limb ? { ...row, appliedAt } : row));
    this.touch("body", { tourniquets }, [], "debounce");
  };

  upsertVital = (row: BoardSnapshot["vitals"][number], when: When = "debounce"): void => {
    this.touch("vitals", { vitals: upsertById(this.snapshot.vitals, row) }, [], when);
  };

  removeVital = (id: string): void => {
    this.touch("vitals", { vitals: this.snapshot.vitals.filter((row) => row.id !== id), paper: unpinPaperRow(this.snapshot.paper, id) }, [], "now");
  };

  upsertFluid = (row: BoardSnapshot["fluids"][number], when: When = "debounce"): void => {
    this.touch("fluids", { fluids: upsertById(this.snapshot.fluids, row) }, [], when);
  };

  removeFluid = (id: string): void => {
    this.touch("fluids", { fluids: this.snapshot.fluids.filter((row) => row.id !== id), paper: unpinPaperRow(this.snapshot.paper, id) }, [], "now");
  };

  upsertMedication = (row: BoardSnapshot["medications"][number], when: When = "debounce"): void => {
    this.touch("meds", { medications: upsertById(this.snapshot.medications, row) }, [], when);
  };

  removeMedication = (id: string): void => {
    this.touch(
      "meds",
      { medications: this.snapshot.medications.filter((row) => row.id !== id), paper: unpinPaperRow(this.snapshot.paper, id) },
      [],
      "now",
    );
  };

  /** Binds a row that is about to be created to the printed column it was typed into. */
  pinPaperSlot = (key: string, id: string): void => {
    this.snapshot = { ...this.snapshot, paper: pinPaperRow(this.snapshot.paper, key, id) };
    this.emit();
  };

  /** Re-sorts the printed tables to the latest rows that fit. Call when the card page is opened. */
  resetPaperLayout = (): void => {
    this.snapshot = { ...this.snapshot, paper: layoutPaper(this.snapshot) };
    this.emit();
  };

  /** Text as typed on the DD1380 sheet. Shown, never saved; see `board/sheet`. */
  setSheetText = (text: Readonly<Record<string, string>>): void => {
    this.snapshot = { ...this.snapshot, sheetText: { ...this.snapshot.sheetText, ...text } };
    this.emit();
  };

  /** Drops typed sheet text, so those fields show the stored values again. */
  dropSheetText = (keys: readonly string[]): void => {
    if (!keys.some((key) => key in this.snapshot.sheetText)) return;
    const sheetText = Object.fromEntries(Object.entries(this.snapshot.sheetText).filter(([key]) => !keys.includes(key)));
    this.snapshot = { ...this.snapshot, sheetText };
    this.emit();
  };

  clearSheetText = (): void => {
    if (Object.keys(this.snapshot.sheetText).length === 0) return;
    this.snapshot = { ...this.snapshot, sheetText: {} };
    this.emit();
  };

  // ── Saving ───────────────────────────────────────────────────────────────

  flush = (): Promise<boolean> => {
    this.clearTimer();
    this.enqueueCurrent(false);
    return this.drain();
  };

  /** Writes the board to Dexie, creating the card when the draft has data. True when nothing is left unsaved. */
  save = async (): Promise<boolean> => {
    this.clearTimer();
    this.enqueueCurrent(true);
    await this.drain();
    return this.dirty.size === 0;
  };

  /**
   * Dirty card fields, trimmed and checked one by one. Invalid values are reported,
   * not saved. A last 4 is saved once all four digits are typed; until then it is
   * pending, so its section stays dirty and the digits stay on screen.
   */
  private currentPatch(): CleanPatch & { pending: CardField[]; drafts: Set<string> } {
    const { identity, mechanism, treatments, notes, responder, rowDrafts } = this.snapshot;
    const sources: Record<string, unknown> = { ...identity, ...mechanism, ...treatments, notes, ...responder };
    const raw: Record<string, unknown> = {};
    const pending: CardField[] = [];
    // Edited row drafts, by row id. The patch carries all of them; the save merges these ids into the stored ones.
    const drafts = new Set<string>();
    for (const key of this.dirtyKeys) {
      if (key.startsWith(DRAFT_KEY)) {
        drafts.add(key.slice(DRAFT_KEY.length));
        continue;
      }
      const value = sources[key];
      if (value === undefined) continue;
      if (LAST4_FIELDS.has(key) && typeof value === "string" && !/^\d{4}$/.test(value)) {
        pending.push(key as CardField);
        continue;
      }
      raw[key] = value;
    }
    if (drafts.size > 0) raw.rowDrafts = rowDrafts;
    return { ...cleanCardPatch(raw), pending, drafts };
  }

  private enqueueCurrent(forceCreate: boolean): void {
    const needsCard = !this.snapshot.cardId && forceCreate && hasDraftContent(this.snapshot);
    if (this.dirty.size === 0 && !needsCard) return;
    const existing = this.jobs.find((job) => job.epoch === this.epoch);
    if (existing) {
      existing.forceCreate = existing.forceCreate || forceCreate;
      return;
    }
    const { patch, invalid, pending, drafts } = this.currentPatch();
    // Clashing rows and held fields wait for the medic's choice (shared conflict policy).
    const held = Object.keys(patch).filter((key) => this.clash?.fields.has(key) && isHeldField(key)) as CardField[];
    for (const key of held) delete (patch as Record<string, unknown>)[key];
    const rows = copyPendingRows(this.pendingRows, this.clash?.rows);
    this.jobs.push({ epoch: this.epoch, draft: this.snapshot, slices: new Set(this.dirty), patch, rows, drafts, held, invalid, pending, forceCreate });
  }

  private drain(): Promise<boolean> {
    if (!this.drainPromise) {
      this.drainPromise = this.runDrain().finally(() => {
        this.drainPromise = null;
        if (this.jobs.length > 0) void this.drain();
        else this.deps.onSettled(this);
      });
    }
    return this.drainPromise;
  }

  private async runDrain(): Promise<boolean> {
    this.saving = true;
    let ok = true;
    try {
      while (this.jobs.length > 0) {
        const job = this.jobs[0]!;
        const saved = await this.runJob(job);
        if (this.jobs[0] === job) this.jobs.shift();
        // A failed job is dropped; its slices are still dirty and the next flush retries them.
        if (!saved) {
          ok = false;
          continue;
        }
        if (this.epoch !== job.epoch && this.dirty.size > 0) this.enqueueCurrent(false);
      }
      return ok;
    } finally {
      this.saving = false;
      const waiting = this.queuedCard;
      this.queuedCard = null;
      if (waiting) this.applyHydrate(waiting);
    }
  }

  private async runJob(job: SaveJob): Promise<boolean> {
    try {
      const id = await this.cardIdFor(job);
      if (!id) return true;
      // A job with no dirty slices only creates the card.
      if (job.slices.size > 0) {
        const edits = { patch: job.patch, rows: job.rows, drafts: job.drafts };
        const outcome = await commitBoard(this.deps.repo, id, job.draft, job.slices, edits, this.base, this.clash, () => true);
        if (outcome.status !== "saved") {
          // With an always-current check, commitBoard aborts only when the card is gone.
          console.warn("Board save skipped: card no longer exists", id);
          return true;
        }
        // Edits another device changed too: the remote banner stays until the medic chooses (P1-003).
        // The second check covers edits made after this job was queued, before `base` moves past them.
        // A known clash follows what the save found stored, before `base` moves past it.
        if (this.clash) this.clash = refreshClash(this.clash, this.base, outcome.before, this.snapshot, this.dirtyKeys);
        this.noteClash(outcome.clash);
        this.noteClash(findClash(this.dirtyKeys, this.pendingRows, this.base, outcome.before, this.snapshot));
        this.base = outcome.stored;
        if (compareHlc(outcome.clientUpdatedAt, this.acked) > 0) this.acked = outcome.clientUpdatedAt;
        if (this.epoch === job.epoch) {
          // A section with a value that could not be stored, or a clashing edit held for the
          // medic's choice, stays dirty: the input stays on screen and is saved later.
          const held = new Set<BoardSlice>([...job.invalid, ...job.pending, ...job.held].map(sliceOfField));
          for (const slice of this.heldSlices()) held.add(slice);
          for (const slice of outcome.skipped) held.add(slice);
          for (const slice of job.slices) {
            if (!held.has(slice)) this.dirty.delete(slice);
          }
          this.forgetSaved(job, outcome.unstored, this.clash);
          this.invalid = [...job.invalid, ...outcome.skipped];
        }
        // The screen follows `base`: a change another device made during the save shows now,
        // before the medic edits over a value they have not seen. Unsaved edits stay on top.
        this.snapshot = this.rebase(outcome.stored);
        this.emit();
      }
      this.failed = false;
      return true;
    } catch (error) {
      this.failed = true;
      reportSaveFailed("board", error);
      return false;
    }
  }

  /**
   * After a save with no newer edit: the fields and rows it stored are no longer unsaved, so a
   * later save never re-sends them over another device's edit (P1-003). Held fields (invalid,
   * a partial last 4) and rows that could not be stored stay.
   */
  private forgetSaved(job: SaveJob, unstored: Record<(typeof ROW_KINDS)[number], ReadonlySet<string>>, withheld: Clash | null): void {
    for (const key of Object.keys(job.patch)) {
      if (key === "rowDrafts") for (const id of job.drafts) this.dirtyKeys.delete(DRAFT_KEY + id);
      else if (!(withheld?.fields.has(key) && isHeldField(key))) this.dirtyKeys.delete(key);
    }
    for (const key of [...this.dirtyKeys]) {
      if (!this.dirty.has(sliceOfField(key))) this.dirtyKeys.delete(key);
    }
    for (const kind of ROW_KINDS) {
      if (!job.slices.has(ROW_SLICE[kind])) continue;
      const edits = this.pendingRows[kind];
      const kept = (key: string) => unstored[kind].has(key) || Boolean(withheld?.rows[kind].has(key));
      for (const key of job.rows[kind].removed) if (!kept(key)) edits.removed.delete(key);
      for (const key of job.rows[kind].changed.keys()) if (!kept(key)) edits.changed.delete(key);
    }
  }

  private async cardIdFor(job: SaveJob): Promise<string | null> {
    if (job.draft.cardId) return job.draft.cardId;
    if (this.snapshot.cardId) return this.snapshot.cardId;
    // Any real content creates the card. An unidentified casualty must not wait for a name.
    if (!job.forceCreate && !hasDraftContent(job.draft)) return null;
    if (!this.creating) {
      const name = job.draft.identity.lastName?.trim() || null;
      // Invalid identity values must not block creating the card; they are reported via the job's patch.
      const initial = cleanCardPatch({ ...job.draft.identity, lastName: name }).patch;
      this.creating = (async () => this.deps.repo.create({ ...responderPatch(await getResponderProfile(db)), ...initial }))();
    }
    const pending = this.creating;
    let card: LocalCasualtyCard;
    try {
      card = await pending;
    } finally {
      if (this.creating === pending) this.creating = null;
    }
    if (this.snapshot.cardId == null) {
      this.acked = card.clientUpdatedAt;
      this.base = snapshotFromCard(card);
      this.snapshot = {
        ...this.snapshot,
        cardId: card.id,
        responder: this.dirty.has("responder")
          ? this.snapshot.responder
          : { responderName: card.responderName, responderLast4: card.responderLast4 },
      };
      this.emit();
      this.deps.onCreated(this, card.id);
      for (const listener of this.idListeners) listener(card.id);
    }
    return card.id;
  }

  private upsertTourniquet(limb: Limb, type: string, appliedAt?: string): BoardSnapshot["tourniquets"] {
    const { tourniquets } = this.snapshot;
    const existing = tourniquets.find((row) => row.limb === limb);
    const row = {
      id: existing?.id ?? newId(),
      limb,
      type,
      appliedAt: appliedAt ?? existing?.appliedAt ?? networkNowIso(),
      clientUpdatedAt: existing?.clientUpdatedAt ?? "",
      deletedAt: null,
    };
    return existing ? tourniquets.map((item) => (item.limb === limb ? row : item)) : [...tourniquets, row];
  }
}
