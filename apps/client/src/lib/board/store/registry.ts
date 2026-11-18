"use client";

import { casualtyRepo, db, listHeldBoardEdits, setHeldBoardEdits, type LocalCasualtyCard } from "@/lib/db";
import { reportSaveFailed, setSaveRetry } from "@/lib/forms/save-status";
import { BoardStore, type BoardDeps } from "./board-store";
import { live, publishInvalidFields, publishSaveStatus } from "./live";

// ── Registry ─────────────────────────────────────────────────────────────────

/** One store per card id. A card opened again while its store is alive gets the same store. */
const byCard = new Map<string, BoardStore>();
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

/** Drops an unmounted store after the grace period, once its held edits are back (P2-031). */
function collectLater(store: BoardStore): void {
  setTimeout(() => {
    if (store.heldReady || store.heldFailed) collect(store);
    else collectLater(store);
  }, UNMOUNTED_GRACE_MS);
}

function collect(store: BoardStore): void {
  if (store.refs > 0 || !store.isSettled()) return;
  live.delete(store);
  if (store.cardId && byCard.get(store.cardId) === store) byCard.delete(store.cardId);
  if (store.reportedInvalid().length > 0) {
    // Its inputs are gone with the screen; an invalid value it held can no longer be fixed there.
    store.invalid = [];
    store.forgetTimeBoxes();
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
  // Never rejects: a failure is reported in the save banner.
  void store.restoreHeld();
  collectLater(store);
  return store;
}

/**
 * At start-up: brings back every card's held edits (P2-031), so the save banner lists them and
 * their stores stay until the medic chooses, without the cards being opened first. A failure is
 * reported in the save banner and does not stop the other cards.
 */
export async function restoreHeldBoards(): Promise<void> {
  let ids: string[];
  try {
    ids = Object.keys(await listHeldBoardEdits(db));
  } catch (error) {
    reportSaveFailed("board", error);
    return;
  }
  for (const id of ids) {
    try {
      const card = await casualtyRepo.getById(id);
      // Gone from this device: nothing is left to choose for. A card deleted elsewhere keeps its
      // entry (it no longer blocks clearing local cards, which then discards it).
      if (!card) await setHeldBoardEdits(db, id, null);
      else if (!card.deletedAt) await boardForCard(card).restoreHeld();
    } catch (error) {
      reportSaveFailed("board", error);
    }
  }
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
  // A reopened card may hold an unfinished time typed earlier or on another device.
  publishInvalidFields();
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
