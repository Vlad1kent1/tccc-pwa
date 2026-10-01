"use client";

import { useSyncExternalStore } from "react";
import type { Connectivity } from "./connectivity";

export type SyncPhase = "idle" | "syncing" | Connectivity;

export interface SyncSnapshot {
  state: SyncPhase;
  connectivity: Connectivity;
  pendingCount: number;
  lastSyncAt: number | null;
  lastError: string | null;
  conflictCount: number;
}

const serverSnapshot: SyncSnapshot = {
  state: "idle",
  connectivity: "offline",
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
  conflictCount: 0,
};

let snapshot: SyncSnapshot = serverSnapshot;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

export function patchSyncStatus(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribe, getSyncSnapshot, () => serverSnapshot);
}
