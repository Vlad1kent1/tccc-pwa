/** One holder at a time across tabs and the service worker: push, pull, and conflict resolution. */
export const SYNC_LOCK = "tccc-sync";

let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` while holding the `tccc-sync` Web Lock. Without Web Locks the
 * same order is kept within this tab. The lock is not re-entrant: a task must
 * never call `withSyncLock` again.
 */
export function withSyncLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(SYNC_LOCK, task) as Promise<T>;
  }
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}
