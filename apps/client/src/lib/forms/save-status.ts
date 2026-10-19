"use client";

import { useSyncExternalStore } from "react";

/** `board` is the per-card board stores, which the tactical board and the DD1380 sheet both write through. */
export type SaveSource = "board";

export interface SourceStatus {
  /** The last write to IndexedDB failed. The edits are on screen but not stored. */
  failed: boolean;
  /** Card fields or board sections left out of the last save because a value is invalid. */
  invalid: string[];
  /** Whether this source can retry the failed write. */
  canRetry: boolean;
}

export type SaveStatus = Record<SaveSource, SourceStatus>;

const CLEAN: SourceStatus = { failed: false, invalid: [], canRetry: false };
const initial: SaveStatus = { board: CLEAN };

let status: SaveStatus = initial;
const listeners = new Set<() => void>();
const retries = new Map<SaveSource, () => void>();

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function patch(source: SaveSource, next: Partial<SourceStatus>): void {
  const current = status[source];
  const merged: SourceStatus = { ...current, ...next, canRetry: retries.has(source) };
  if (merged.failed === current.failed && merged.canRetry === current.canRetry && sameList(merged.invalid, current.invalid)) {
    return;
  }
  status = { ...status, [source]: merged };
  for (const listener of listeners) listener();
}

export function reportSaveFailed(source: SaveSource, error: unknown): void {
  console.error(`${source} save failed`, error);
  patch(source, { failed: true });
}

export function reportSaved(source: SaveSource): void {
  patch(source, { failed: false });
}

export function reportInvalidFields(source: SaveSource, fields: readonly string[]): void {
  patch(source, { invalid: [...fields] });
}

export function clearSaveStatus(source: SaveSource): void {
  patch(source, { failed: false, invalid: [] });
}

/** Registers how `source` retries a failed write; `null` when it no longer can (e.g. the form unmounted). */
export function setSaveRetry(source: SaveSource, retry: (() => void) | null): void {
  if (retry) retries.set(source, retry);
  else retries.delete(source);
  patch(source, {});
}

export function retrySave(source: SaveSource): void {
  retries.get(source)?.();
}

export function getSaveStatus(): SaveStatus {
  return status;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(subscribe, getSaveStatus, () => initial);
}
