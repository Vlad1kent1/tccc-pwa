import type { TcccDB } from "@/lib/db";
import { ApiError, isRetryableError, isUnauthorized } from "./api";
import { backoffDelayMs } from "./backoff";
import { probeConnectivity, type Connectivity } from "./connectivity";
import { pullAll, pushOutbox } from "./pipeline";
import { getSyncSnapshot, patchSyncStatus, type SyncErrorPayload } from "./status-store";
import { withSyncLock } from "./lock";
import { readUnitToken } from "./unit-token";

/** Never retry sooner than this, even when the jittered backoff draws a delay near zero. */
const MIN_RETRY_DELAY_MS = 1_000;

let inFlight: Promise<void> | null = null;
let rerun = false;
let force = false;
let notBefore = 0;
/** Failed attempts since the last complete sync; the backoff grows with it. */
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function refreshCounts(db: TcccDB): Promise<void> {
  const [pendingCount, conflictCount] = await Promise.all([
    db.outbox.where("status").anyOf("queued", "inflight").count(),
    db.conflicts.where("open").equals(1).count(),
  ]);
  patchSyncStatus({ pendingCount, conflictCount });
}

function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Backs off after a failed attempt and schedules the next one for when the backoff ends, so
 * sync recovers on its own instead of waiting for the next interval tick (five minutes after a
 * failed probe) or a reload. `attempts` lets mutations that already failed often wait longer.
 */
function scheduleRetry(db: TcccDB, attempts = 0): void {
  failures += 1;
  const delay = Math.max(MIN_RETRY_DELAY_MS, backoffDelayMs(Math.max(failures, attempts)));
  notBefore = Date.now() + delay;
  if (retryTimer) clearTimeout(retryTimer);
  // Slightly past `notBefore`, so the gate in `syncOnce` is open when the timer fires.
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void syncNow(db);
  }, delay + 50);
}

function clearBackoff(): void {
  failures = 0;
  notBefore = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
}

function syncFailure(error: unknown): SyncErrorPayload {
  if (error instanceof ApiError) return { message: error.message, status: error.status };
  return { message: error instanceof Error ? error.message : "Sync failed", status: null };
}

/**
 * Offline is only a dropped network interface or a failed health probe.
 * HTTP 4xx and other non-retryable failures stay degraded, with `lastError`,
 * so a stuck outbox is not shown as a generic offline state.
 * A 401 also pauses automatic sync until the unit token changes.
 */
function failSync(error: unknown): void {
  const lastError = syncFailure(error);
  if (isUnauthorized(error)) {
    patchSyncStatus({ state: "degraded", lastError, authProblem: "rejected" });
    return;
  }
  if (browserOffline()) {
    patchSyncStatus({ connectivity: "offline", state: "offline", lastError });
    return;
  }
  patchSyncStatus({ state: "degraded", lastError });
}

async function syncOnce(db: TcccDB, manual: boolean): Promise<void> {
  if (!manual && Date.now() < notBefore) return;
  // Retrying a refused token every 30 s only fills the server log; wait for a new one.
  if (!manual && getSyncSnapshot().authProblem) return;

  patchSyncStatus({ state: "syncing" });
  try {
    const connectivity: Connectivity = await probeConnectivity();
    patchSyncStatus({ connectivity });
    if (connectivity === "offline") {
      patchSyncStatus({ state: "offline" });
      // The network is up but the server did not answer, e.g. while it restarts: try again
      // after the backoff. A dropped network waits for the `online` event instead.
      if (!browserOffline()) scheduleRetry(db);
      await refreshCounts(db);
      return;
    }
    // Queued mutations stay in the outbox; nothing is sent without a token.
    if (!(await readUnitToken())) {
      patchSyncStatus({
        state: "degraded",
        authProblem: "missing",
        lastError: { message: "Unit token is not set", status: 401 },
      });
      await refreshCounts(db);
      return;
    }
    // `unknown` means the health probe timed out. Still push once. A slow
    // reply must not be stored as offline, or the next automatic attempt waits
    // five minutes.

    const outcome = await pushOutbox(db, ({ attempts, message, status }) => {
      scheduleRetry(db, attempts);
      patchSyncStatus({ lastError: { message, status: status ?? null } });
    });
    if (outcome === "retry") {
      patchSyncStatus({ state: connectivity === "online" ? "degraded" : connectivity, authProblem: null });
    } else {
      // The server answered, so pull even when some mutations wait for their retry.
      await pullAll(db);
      const reached = connectivity === "unknown" ? "online" : connectivity;
      if (outcome === "ok") {
        clearBackoff();
        patchSyncStatus({
          connectivity: reached,
          state: reached,
          lastSyncAt: Date.now(),
          lastError: null,
          authProblem: null,
        });
      } else {
        patchSyncStatus({ connectivity: reached, state: "degraded", authProblem: null });
      }
    }
    await refreshCounts(db);
  } catch (error) {
    failSync(error);
    // A 5xx or a timeout from the pull, or a dropped request: retry after the backoff.
    if (isRetryableError(error) && !browserOffline()) scheduleRetry(db);
    await refreshCounts(db).catch(() => undefined);
  }
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
        await withSyncLock(() => syncOnce(db, manualPass));
      } catch (error) {
        failSync(error);
      }
    } while (rerun);
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Drops the backoff and any scheduled retry. */
export function resetSyncBackoff(): void {
  clearBackoff();
}

/** After a new unit token: lift the pause and the backoff, then sync at once. */
export function resumeAfterTokenChange(db: TcccDB): Promise<void> {
  clearBackoff();
  patchSyncStatus({ authProblem: null, lastError: null });
  return syncNow(db, { manual: true });
}
