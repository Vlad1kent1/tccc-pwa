"use client";

import { casualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import { setSaveRetry } from "@/lib/forms/save-status";
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
