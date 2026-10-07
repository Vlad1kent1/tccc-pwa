import type { TcccDB } from "@/lib/db";
import { ApiError } from "./api";
import { backoffDelayMs } from "./backoff";
import { probeConnectivity, type Connectivity } from "./connectivity";
import { pullAll, pushOutbox } from "./pipeline";
import { patchSyncStatus, type SyncErrorPayload } from "./status-store";

const LOCK_NAME = "tccc-sync";

let inFlight: Promise<void> | null = null;
let rerun = false;
let force = false;
let notBefore = 0;

async function refreshCounts(db: TcccDB): Promise<void> {
  const [pendingCount, conflictCount] = await Promise.all([
    db.outbox.where("status").anyOf("queued", "inflight").count(),
    db.conflicts.where("open").equals(1).count(),
  ]);
  patchSyncStatus({ pendingCount, conflictCount });
}

function syncFailure(error: unknown): SyncErrorPayload {
  if (error instanceof ApiError) return { message: error.message, status: error.status };
  return { message: error instanceof Error ? error.message : "Sync failed", status: null };
}

/**
 * Offline is only a dropped network interface or a failed health probe.
 * HTTP 4xx and other non-retryable failures stay degraded, with `lastError`,
 * so a stuck outbox is not shown as a generic offline state.
 */
function failSync(error: unknown): void {
  const lastError = syncFailure(error);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    patchSyncStatus({ connectivity: "offline", state: "offline", lastError });
    return;
  }
  patchSyncStatus({ state: "degraded", lastError });
}

async function syncOnce(db: TcccDB, manual: boolean): Promise<void> {
  if (!manual && Date.now() < notBefore) return;

  patchSyncStatus({ state: "syncing" });
  try {
    const connectivity: Connectivity = await probeConnectivity();
    patchSyncStatus({ connectivity });
    if (connectivity === "offline") {
      patchSyncStatus({ state: "offline" });
      await refreshCounts(db);
      return;
    }
    // `unknown` means the health probe timed out. Still push once. A slow
    // reply must not be stored as offline, or the next automatic attempt waits
    // five minutes.

    const outcome = await pushOutbox(db, ({ attempts, message }) => {
      notBefore = Date.now() + backoffDelayMs(attempts);
      patchSyncStatus({ lastError: { message, status: null } });
    });
    if (outcome === "ok") {
      await pullAll(db);
      notBefore = 0;
      const reached = connectivity === "unknown" ? "online" : connectivity;
      patchSyncStatus({ connectivity: reached, state: reached, lastSyncAt: Date.now(), lastError: null });
    } else {
      patchSyncStatus({ state: connectivity === "online" ? "degraded" : connectivity });
    }
    await refreshCounts(db);
  } catch (error) {
    failSync(error);
    await refreshCounts(db).catch(() => undefined);
  }
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
  if (manual) force = true;
  if (inFlight) {
    rerun = true;
    return inFlight;
  }

  inFlight = (async () => {
    do {
      rerun = false;
      const manualPass = force;
      force = false;
      try {
        await withLock(() => syncOnce(db, manualPass));
      } catch (error) {
        failSync(error);
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
