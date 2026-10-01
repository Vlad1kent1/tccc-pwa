import { db } from "../db/schema";
import { pushOutbox } from "./pipeline";

const LOCK_NAME = "tccc-sync";

/**
 * Minimal push used by the service worker when no window is open.
 * Shares the `tccc-sync` Web Lock with `syncNow` so a tab and the worker
 * never push the same outbox at once.
 */
export async function pushOutboxFromWorker(): Promise<void> {
  const run = () => pushOutbox(db);
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(LOCK_NAME, run);
    return;
  }
  await run();
}
