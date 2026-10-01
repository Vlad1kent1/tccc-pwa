import type { TcccDB } from "@/lib/db";
import { backoffDelayMs } from "./backoff";
import { probeConnectivity, type Connectivity } from "./connectivity";
import { pullAll, pushOutbox } from "./pipeline";
import { patchSyncStatus } from "./status-store";

const LOCK_NAME = "tccc-sync";

let inFlight: Promise<void> | null = null;
let rerun = false;
let notBefore = 0;

async function refreshCounts(db: TcccDB): Promise<void> {
  const [pendingCount, conflictCount] = await Promise.all([
    db.outbox.where("status").anyOf("queued", "inflight").count(),
    db.conflicts.filter((conflict) => conflict.resolvedAt == null).count(),
  ]);
  patchSyncStatus({ pendingCount, conflictCount });
}

async function syncOnce(db: TcccDB, manual: boolean): Promise<void> {
  if (!manual && Date.now() < notBefore) return;

  patchSyncStatus({ state: "syncing" });
  const connectivity: Connectivity = await probeConnectivity();
  patchSyncStatus({ connectivity });
  if (connectivity === "offline") {
    patchSyncStatus({ state: "offline" });
    await refreshCounts(db);
    return;
  }

  const outcome = await pushOutbox(db, ({ attempts, message }) => {
    notBefore = Date.now() + backoffDelayMs(attempts);
    patchSyncStatus({ lastError: message });
  });
  if (outcome === "ok") {
    await pullAll(db);
    notBefore = 0;
    patchSyncStatus({ state: connectivity, lastSyncAt: Date.now(), lastError: null });
  } else {
    patchSyncStatus({ state: connectivity === "online" ? "degraded" : connectivity });
  }
  await refreshCounts(db);
}

async function withLock(task: () => Promise<void>): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(LOCK_NAME, task);
    return;
  }
  await task();
}

/** Single-flight push, then pull. One tab holds the `tccc-sync` Web Lock at a time. */
export function syncNow(db: TcccDB, options?: { manual?: boolean }): Promise<void> {
  const manual = options?.manual ?? false;
  if (inFlight) {
    rerun = true;
    return inFlight;
  }

  inFlight = (async () => {
    do {
      rerun = false;
      try {
        await withLock(() => syncOnce(db, manual));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        patchSyncStatus({ state: "offline", lastError: message });
      }
    } while (rerun);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function resetSyncBackoff(): void {
  notBefore = 0;
}
