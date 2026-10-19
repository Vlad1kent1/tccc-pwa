import type { TcccDB } from "@/lib/db";
import { resetSyncBackoff, resumeAfterTokenChange, syncNow } from "./engine";
import { getSyncSnapshot, patchSyncStatus } from "./status-store";
import { UNIT_TOKEN_STORAGE_KEY } from "./unit-token";

const ONLINE_INTERVAL_MS = 30_000;
const OFFLINE_INTERVAL_MS = 5 * 60_000;
const WRITE_DEBOUNCE_MS = 2_000;

let writeTimer: ReturnType<typeof setTimeout> | undefined;
let intervalTimer: ReturnType<typeof setTimeout> | undefined;

/** Registers `tccc-outbox` when the browser supports Background Sync. */
export async function registerOutboxSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sync = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync;
  if (!sync) return;
  await sync.register("tccc-outbox");
}

function scheduleAfterWrite(db: TcccDB): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    void syncNow(db);
  }, WRITE_DEBOUNCE_MS);
}

function armInterval(db: TcccDB): void {
  const delay = getSyncSnapshot().connectivity === "offline" ? OFFLINE_INTERVAL_MS : ONLINE_INTERVAL_MS;
  intervalTimer = setTimeout(() => {
    void syncNow(db).finally(() => armInterval(db));
  }, delay);
}

/** Starts online, visibility, interval, post-write, and service-worker triggers. */
export function startSyncTriggers(db: TcccDB): () => void {
  const onOnline = () => {
    void syncNow(db);
  };
  const onOffline = () => {
    patchSyncStatus({ connectivity: "offline", state: "offline" });
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncNow(db);
  };
  const onSwMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (data?.type === "tccc-outbox") void syncNow(db);
  };
  const onOutboxCreate = () => {
    void registerOutboxSync().catch(() => undefined);
    scheduleAfterWrite(db);
  };
  // A token saved in another tab lifts this tab's pause too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === UNIT_TOKEN_STORAGE_KEY) void resumeAfterTokenChange(db);
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", onStorage);
  navigator.serviceWorker?.addEventListener("message", onSwMessage);
  db.outbox.hook("creating", onOutboxCreate);
  armInterval(db);
  void syncNow(db);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("storage", onStorage);
    navigator.serviceWorker?.removeEventListener("message", onSwMessage);
    db.outbox.hook("creating").unsubscribe(onOutboxCreate);
    if (writeTimer) clearTimeout(writeTimer);
    if (intervalTimer) clearTimeout(intervalTimer);
    resetSyncBackoff();
  };
}

export function requestSync(db: TcccDB): Promise<void> {
  return syncNow(db, { manual: true });
}
