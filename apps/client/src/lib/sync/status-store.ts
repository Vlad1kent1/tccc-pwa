"use client";

import { useSyncExternalStore } from "react";
import type { Connectivity } from "./connectivity";

export type SyncPhase = "idle" | "syncing" | Connectivity;

/** Why the last sync attempt failed. `status` is the HTTP code when the API answered. */
export interface SyncErrorPayload {
  message: string;
  status: number | null;
}

export interface SyncSnapshot {
  state: SyncPhase;
  connectivity: Connectivity;
  pendingCount: number;
  lastSyncAt: number | null;
  lastError: SyncErrorPayload | null;
  conflictCount: number;
}

/** Header and status-bar mode. Degraded covers API failures; offline is connectivity only. */
export function connectivityMode(status: Pick<SyncSnapshot, "state" | "connectivity">): "online" | "offline" | "syncing" | "degraded" {
  if (status.state === "syncing") return "syncing";
  if (status.state === "degraded" || status.state === "unknown") return "degraded";
  if (status.state === "offline" || status.connectivity === "offline") return "offline";
  if (status.connectivity === "degraded" || status.connectivity === "unknown") return "degraded";
  return "online";
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
