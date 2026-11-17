"use client";

import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { EMPTY_SNAPSHOT, type BoardSnapshot } from "../snapshot";
import type { BoardStore, TimeBoxSlice } from "./board-store";
import { flushAllBoards, releaseBoard, retainBoard } from "./registry";

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

/**
 * A row time box's flag (vitals, fluid or medication), derived from the row's draft text.
 * Call `focus(id)` when the box gains focus or its row is created, and `focus(null)` on blur:
 * the box is flagged only once it is left. `id` is undefined while the box has no row yet.
 */
export function useRowTimeBox(id: string | undefined): { unfinished: boolean; focus: (id: string | null | undefined) => void } {
  const store = useBoard();
  const unfinished = useSyncExternalStore(
    store.subscribe,
    () => (id ? store.isTimeBoxUnfinished(id) : false),
    () => false,
  );
  return { unfinished, focus: (next) => store.focusTimeBox(next ?? null) };
}

/**
 * The flag of a time box whose text is not stored (the tourniquet time). `check(text)` on
 * blur flags text that is not a complete time; `check(text, true)` while typing only clears it.
 */
export function useTimeBox(key: string | undefined, slice: TimeBoxSlice): { unfinished: boolean; check: (text: string, typing?: boolean) => void } {
  const store = useBoard();
  const unfinished = useSyncExternalStore(
    store.subscribe,
    () => (key ? store.isTimeBoxUnfinished(key) : false),
    () => false,
  );
  return {
    unfinished,
    check: (text, typing = false) => {
      if (key) store.checkTimeBox(key, slice, text, typing);
    },
  };
}
