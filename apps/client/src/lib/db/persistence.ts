import { getMeta, setMeta } from "./meta";
import type { TcccDB } from "./schema";

export interface StorageStatus {
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

/**
 * Asks the browser not to evict IndexedDB under storage pressure (NFR-02).
 * Browsers may grant this silently, prompt, or refuse.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (error) {
    console.warn("Persistent storage request failed", error);
    return false;
  }
}

/**
 * Requests persistent storage once per installation and records that in `meta`.
 * Firefox shows a permission prompt on every `persist()` call, so a refusal is
 * not re-asked on each launch; the settings page reports the current state.
 */
export async function ensurePersistentStorage(db: TcccDB): Promise<boolean> {
  if (await getMeta(db, "persistenceRequested")) {
    return (await navigator.storage?.persisted?.()) ?? false;
  }
  const granted = await requestPersistentStorage();
  await setMeta(db, "persistenceRequested", true);
  return granted;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return { persisted: false, usage: null, quota: null };
  }
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.() ?? Promise.resolve(false),
    navigator.storage.estimate?.() ?? Promise.resolve({} as StorageEstimate),
  ]);
  return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
}
