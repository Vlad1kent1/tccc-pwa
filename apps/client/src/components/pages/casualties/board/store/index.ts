"use client";

import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
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
import { casualtyRepo, db, getResponderProfile, type CasualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import { cleanCardPatch, type CleanPatch } from "@/lib/forms/card-patch";
import { reportInvalidFields, reportSaveFailed, reportSaved, setSaveRetry } from "@/lib/forms/save-status";
import { responderPatch } from "@/lib/forms/values";
import { networkNowIso } from "@/lib/network-clock";
import { layoutPaper, pinPaperRow, unpinPaperRow } from "@/components/pages/casualties/board/paper-layout";
import { reconcileTreatments } from "@/components/pages/casualties/board/treatment-flags";
import { regionAt } from "@/components/pages/casualties/board/regions";
import { commitBoard } from "@/components/pages/casualties/board/commit";
import {
  EMPTY_SNAPSHOT,
  emptySnapshot,
  snapshotFromCard,
  type BoardSlice,
  type BoardSnapshot,
  type BoardTreatments,
  type TreatmentListKey,
} from "@/components/pages/casualties/board/snapshot";

export type { BoardSlice, BoardSnapshot };

type When = "debounce" | "now";

const DEBOUNCE_MS = 400;
const MARK_RADIUS = 0.04;
const LAST4_FIELDS = new Set<string>(["casualtyLast4", "responderLast4"]);

interface SaveJob {
  epoch: number;
  draft: BoardSnapshot;
  slices: Set<BoardSlice>;
  patch: CardPatch;
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
  private readonly dirtyKeys = new Set<string>();
  private readonly jobs: SaveJob[] = [];
  private epoch = 0;
  private saving = false;
  /** `clientUpdatedAt` of the card as this store last wrote or adopted it. */
  private acked = "";
  /** A remote version the medic chose to keep their edits over. */
  private heldAt: string | null = null;
  private incoming: LocalCasualtyCard | null = null;
  private queuedCard: LocalCasualtyCard | null = null;
  private creating: Promise<LocalCasualtyCard> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drainPromise: Promise<boolean> | null = null;
  /** The last write failed. The edits are still dirty here and are retried by the next flush. */
  failed = false;
  /** Fields and sections left out of the last save, for the save banner. */
  invalid: readonly string[] = [];
  /** Mounted screens using this store. The registry drops it at zero once its saves settle. */
  refs = 0;

  constructor(
    private readonly deps: BoardDeps,
    card: LocalCasualtyCard | null,
  ) {
    this.snapshot = card ? snapshotFromCard(card) : emptySnapshot(null);
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

  /** No timer, no queued or running save, no card being created, and the last save did not fail. */
  isSettled(): boolean {
    return this.timer === undefined && this.jobs.length === 0 && !this.drainPromise && !this.creating && !this.failed;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
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

  private applyHydrate(card: LocalCasualtyCard): void {
    if (this.acked && compareHlc(card.clientUpdatedAt, this.acked) < 0) return;
    if (card.clientUpdatedAt === this.heldAt) return;
    if (card.clientUpdatedAt === this.acked || this.dirty.size === 0) {
      this.acked = card.clientUpdatedAt;
      this.heldAt = null;
      this.incoming = null;
      this.snapshot = this.mergeUndirty(card);
      this.emit();
      return;
    }
    this.incoming = card;
    if (!this.snapshot.remote) {
      this.snapshot = { ...this.snapshot, remote: true };
      this.emit();
    }
  }

  private mergeUndirty(card: LocalCasualtyCard): BoardSnapshot {
    const current = this.snapshot;
    const next = snapshotFromCard(card);
    // A dirty slice keeps what is on screen. A clean one takes the card's value, but
    // keeps its old object when nothing in it changed: every save re-reads the card,
    // and new objects would re-render every block and the injury figures each time.
    const take = <K extends keyof BoardSnapshot>(key: K, slice: BoardSlice): BoardSnapshot[K] =>
      this.dirty.has(slice) || sameJson(current[key], next[key]) ? current[key] : next[key];
    const merged: BoardSnapshot = {
      ...next,
      remote: false,
      identity: take("identity", "identity"),
      mechanism: take("mechanism", "mechanism"),
      injuries: take("injuries", "body"),
      tourniquets: take("tourniquets", "body"),
      treatments: take("treatments", "treatments"),
      vitals: take("vitals", "vitals"),
      fluids: take("fluids", "fluids"),
      medications: take("medications", "meds"),
      notes: take("notes", "notes"),
      responder: take("responder", "responder"),
      rowDrafts: take("rowDrafts", "drafts"),
      sheetText: current.sheetText,
    };
    // Columns keep their rows across updates; only `resetPaperLayout` re-sorts them.
    return { ...merged, paper: layoutPaper(merged, current.paper) };
  }

  keepEdits = (): void => {
    if (this.incoming) this.heldAt = this.incoming.clientUpdatedAt;
    this.incoming = null;
    this.snapshot = { ...this.snapshot, remote: false };
    this.epoch += 1;
    this.emit();
    void this.flush();
  };

  loadUpdate = (): void => {
    const card = this.incoming;
    if (!card) return;
    this.dirty.clear();
    this.dirtyKeys.clear();
    this.acked = card.clientUpdatedAt;
    this.heldAt = null;
    this.incoming = null;
    this.snapshot = snapshotFromCard(card);
    this.epoch += 1;
    this.clearTimer();
    this.emit();
  };

  // ── Edits ────────────────────────────────────────────────────────────────

  private touch(slice: BoardSlice, partial: Partial<BoardSnapshot>, keys: readonly string[], when: When): void {
    this.epoch += 1;
    this.dirty.add(slice);
    for (const key of keys) this.dirtyKeys.add(key);
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

  /** Unfinished vitals, fluid, and medication cell text. Saved and synced like any card field. */
  editRowDrafts = (rowDrafts: BoardSnapshot["rowDrafts"]): void => {
    this.touch("drafts", { rowDrafts }, ["rowDrafts"], "debounce");
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

  /** A blank type removes the limb's tourniquet. Without `appliedAt` a new one is stamped now. */
  setLimbTourniquet = (limb: Limb, type: string, appliedAt?: string): void => {
    const trimmed = type.trim().slice(0, 50);
    const tourniquets = trimmed
      ? this.upsertTourniquet(limb, trimmed, appliedAt)
      : this.snapshot.tourniquets.filter((row) => row.limb !== limb);
    this.touch("body", { tourniquets }, [], trimmed ? "debounce" : "now");
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
  private currentPatch(): CleanPatch & { pending: CardField[] } {
    const { identity, mechanism, treatments, notes, responder, rowDrafts } = this.snapshot;
    const sources: Record<string, unknown> = { ...identity, ...mechanism, ...treatments, notes, ...responder, rowDrafts };
    const raw: Record<string, unknown> = {};
    const pending: CardField[] = [];
    for (const key of this.dirtyKeys) {
      const value = sources[key];
      if (value === undefined) continue;
      if (LAST4_FIELDS.has(key) && typeof value === "string" && !/^\d{4}$/.test(value)) {
        pending.push(key as CardField);
        continue;
      }
      raw[key] = value;
    }
    return { ...cleanCardPatch(raw), pending };
  }

  private enqueueCurrent(forceCreate: boolean): void {
    const needsCard = !this.snapshot.cardId && forceCreate && hasDraftContent(this.snapshot);
    if (this.dirty.size === 0 && !needsCard) return;
    const existing = this.jobs.find((job) => job.epoch === this.epoch);
    if (existing) {
      existing.forceCreate = existing.forceCreate || forceCreate;
      return;
    }
    const { patch, invalid, pending } = this.currentPatch();
    this.jobs.push({ epoch: this.epoch, draft: this.snapshot, slices: new Set(this.dirty), patch, invalid, pending, forceCreate });
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
        const outcome = await commitBoard(this.deps.repo, id, job.draft, job.slices, job.patch, () => true);
        if (outcome.status !== "saved") {
          // With an always-current check, commitBoard aborts only when the card is gone.
          console.warn("Board save skipped: card no longer exists", id);
          return true;
        }
        if (this.epoch === job.epoch) {
          // A section with a value that could not be stored stays dirty: the input stays
          // on screen and is retried instead of being replaced by the stored card.
          const held = new Set<BoardSlice>([...job.invalid, ...job.pending].map(sliceOfField));
          for (const slice of outcome.skipped) held.add(slice);
          this.acked = outcome.clientUpdatedAt;
          this.heldAt = null;
          this.incoming = null;
          for (const slice of job.slices) {
            if (!held.has(slice)) this.dirty.delete(slice);
          }
          if (this.dirty.size === 0) this.dirtyKeys.clear();
          if (this.snapshot.remote) this.snapshot = { ...this.snapshot, remote: false };
          this.invalid = [...job.invalid, ...outcome.skipped];
          this.emit();
        }
      }
      this.failed = false;
      return true;
    } catch (error) {
      this.failed = true;
      reportSaveFailed("board", error);
      return false;
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

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function upsertById<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((item) => item.id === row.id) ? rows.map((item) => (item.id === row.id ? row : item)) : [...rows, row];
}

function sliceOfField(field: CardField): BoardSlice {
  if (field === "rowDrafts") return "drafts";
  if (field in EMPTY_SNAPSHOT.identity) return "identity";
  if (field in EMPTY_SNAPSHOT.mechanism) return "mechanism";
  if (field in EMPTY_SNAPSHOT.treatments) return "treatments";
  if (field in EMPTY_SNAPSHOT.responder) return "responder";
  return "notes";
}

function hasDraftContent(draft: BoardSnapshot): boolean {
  const { identity, mechanism, treatments, responder } = draft;
  const text = [
    identity.lastName,
    identity.firstName,
    identity.allergies,
    identity.battleRosterNumber,
    identity.casualtyLast4,
    identity.service,
    identity.unit,
    mechanism.mechanismOther,
    draft.notes,
    treatments.hypothermiaType,
    treatments.dressingOtherType,
    treatments.circulationTqType,
    treatments.circulationDressingType,
    treatments.airwayType,
    treatments.breathingType,
    responder.responderName,
    responder.responderLast4,
  ].some((value) => Boolean(value?.trim()));
  return (
    text ||
    identity.gender != null ||
    identity.evacPriority != null ||
    identity.injuredAt != null ||
    mechanism.mechanisms.length > 0 ||
    draft.injuries.length > 0 ||
    draft.tourniquets.length > 0 ||
    draft.vitals.length > 0 ||
    draft.fluids.length > 0 ||
    draft.medications.length > 0 ||
    treatments.circulation.length > 0 ||
    treatments.airway.length > 0 ||
    treatments.breathing.length > 0 ||
    treatments.otherTreatments.length > 0 ||
    treatments.tqExtremity ||
    treatments.tqJunctional ||
    treatments.tqTruncal ||
    treatments.combatPillPack ||
    treatments.eyeShieldRight ||
    treatments.eyeShieldLeft
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function limbForRegion(region: BodyRegion): Limb | null {
  if (region === "RIGHT_ARM") return Limb.RIGHT_ARM;
  if (region === "LEFT_ARM") return Limb.LEFT_ARM;
  if (region === "RIGHT_LEG") return Limb.RIGHT_LEG;
  if (region === "LEFT_LEG") return Limb.LEFT_LEG;
  return null;
}

// ── Registry ─────────────────────────────────────────────────────────────────

/** One store per card id. A card opened again while its store is alive gets the same store. */
const byCard = new Map<string, BoardStore>();
/** Every store that may hold unsaved edits, including a new casualty's draft before its card exists. */
const live = new Set<BoardStore>();
/** A store created during a render that never mounts is dropped after this long. */
const UNMOUNTED_GRACE_MS = 5_000;

const appDeps: BoardDeps = {
  repo: casualtyRepo,
  onCreated(store, cardId) {
    if (!byCard.has(cardId)) byCard.set(cardId, store);
  },
  onSettled(store) {
    publishSaveStatus();
    collect(store);
  },
};

setSaveRetry("board", () => {
  void flushAllBoards();
});

/** The save banner shows every live store: a failure on any card stays visible until it is saved. */
function publishSaveStatus(): void {
  const stores = [...live];
  reportInvalidFields("board", [...new Set(stores.flatMap((store) => store.invalid))]);
  if (!stores.some((store) => store.failed)) reportSaved("board");
}

function collect(store: BoardStore): void {
  if (store.refs > 0 || !store.isSettled()) return;
  live.delete(store);
  if (store.cardId && byCard.get(store.cardId) === store) byCard.delete(store.cardId);
  if (store.invalid.length > 0) {
    // Its inputs are gone with the screen; an invalid value it held can no longer be fixed there.
    store.invalid = [];
    publishSaveStatus();
  }
}

/** The store of `card`, created from it on first use. Safe to call during render. */
export function boardForCard(card: LocalCasualtyCard): BoardStore {
  const existing = byCard.get(card.id);
  if (existing) return existing;
  const store = new BoardStore(appDeps, card);
  byCard.set(card.id, store);
  live.add(store);
  setTimeout(() => collect(store), UNMOUNTED_GRACE_MS);
  return store;
}

export function peekBoard(cardId: string): BoardStore | undefined {
  return byCard.get(cardId);
}

/** A store for a new casualty. It joins the registry when it is mounted or creates its card. */
export function createDraftBoard(): BoardStore {
  return new BoardStore(appDeps, null);
}

export function retainBoard(store: BoardStore): void {
  store.refs += 1;
  live.add(store);
  const id = store.cardId;
  if (id && !byCard.has(id)) byCard.set(id, store);
}

/** The last screen left: pending edits are saved, then the store is dropped once its saves settle. */
export function releaseBoard(store: BoardStore): void {
  store.refs = Math.max(0, store.refs - 1);
  if (store.refs > 0) return;
  void store.flush();
  collect(store);
}

export function flushAllBoards(): Promise<boolean> {
  return Promise.all([...live].map((store) => store.flush())).then((results) => results.every(Boolean));
}

/** For tests: the stores still held by the registry. */
export function liveBoards(): ReadonlySet<BoardStore> {
  return live;
}

// ── React bindings ───────────────────────────────────────────────────────────

const BoardContext = createContext<BoardStore | null>(null);

export function BoardProvider({ store, children }: { store: BoardStore; children: ReactNode }) {
  return createElement(BoardContext.Provider, { value: store }, children);
}

export function useBoard(): BoardStore {
  const store = useContext(BoardContext);
  if (!store) throw new Error("Board components must render inside BoardProvider");
  return store;
}

/** Keeps `store` alive while the calling screen is mounted. */
export function useRetainBoard(store: BoardStore | null | undefined): void {
  useEffect(() => {
    if (!store) return;
    retainBoard(store);
    return () => releaseBoard(store);
  }, [store]);
}

/**
 * Saves pending edits of every card when the page is hidden or unloaded. A
 * backgrounded PWA can be killed by the OS without further events, so a pending
 * debounce would be lost.
 */
export function useFlushBoardOnHide(): void {
  useEffect(() => {
    const flush = () => {
      void flushAllBoards();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, []);
}

/**
 * A part of the snapshot. `select` must return a value already in the snapshot (a
 * slice, a row, a primitive), never a new object or array, or React re-renders forever.
 */
export function useSlice<T>(select: (state: BoardSnapshot) => T): T {
  const store = useBoard();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(EMPTY_SNAPSHOT),
  );
}
