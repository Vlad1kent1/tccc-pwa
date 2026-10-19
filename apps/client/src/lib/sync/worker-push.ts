import { db } from "../db/schema";
import { withSyncLock } from "./lock";
import { pushOutbox } from "./pipeline";
import { readUnitToken } from "./unit-token";

/**
 * Minimal push used by the service worker when no window is open.
 * Shares the `tccc-sync` Web Lock with `syncNow` so a tab and the worker
 * never push the same outbox at once. Without a unit token the outbox waits
 * for a window, where the medic can enter one. A push that did not finish rejects, so the
 * browser fires the Background Sync event again later, with its own backoff.
 */
export async function pushOutboxFromWorker(): Promise<void> {
  if (!(await readUnitToken())) return;
  const outcome = await withSyncLock(() => pushOutbox(db));
  if (outcome !== "ok") throw new Error(`Outbox push did not finish (${outcome}); Background Sync will retry`);
}
