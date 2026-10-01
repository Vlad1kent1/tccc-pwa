import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMeta } from "./meta";
import { ensurePersistentStorage, getStorageStatus, requestPersistentStorage } from "./persistence";
import { TcccDB } from "./schema";

let db: TcccDB;
const storage = {
  persisted: vi.fn<() => Promise<boolean>>(),
  persist: vi.fn<() => Promise<boolean>>(),
  estimate: vi.fn<() => Promise<StorageEstimate>>(),
};

beforeEach(() => {
  db = new TcccDB(`tccc-test-${crypto.randomUUID()}`);
  storage.persisted.mockResolvedValue(false);
  storage.persist.mockResolvedValue(false);
  storage.estimate.mockResolvedValue({ usage: 2048, quota: 1_000_000 });
  vi.stubGlobal("navigator", { storage });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await db.delete();
});

describe("ensurePersistentStorage", () => {
  it("requests persistence on first launch and records it in meta", async () => {
    storage.persist.mockResolvedValue(true);

    expect(await ensurePersistentStorage(db)).toBe(true);
    expect(storage.persist).toHaveBeenCalledOnce();
    expect(await getMeta(db, "persistenceRequested")).toBe(true);
  });

  it("does not ask again after a refusal", async () => {
    await ensurePersistentStorage(db);
    await ensurePersistentStorage(db);

    expect(storage.persist).toHaveBeenCalledOnce();
    expect(await getMeta(db, "persistenceRequested")).toBe(true);
  });

  it("skips the request when storage is already persistent", async () => {
    storage.persisted.mockResolvedValue(true);

    expect(await ensurePersistentStorage(db)).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
  });
});

describe("requestPersistentStorage", () => {
  it("returns false and warns when the browser rejects persist()", async () => {
    storage.persist.mockRejectedValue(new Error("denied"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(await requestPersistentStorage()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("getStorageStatus", () => {
  it("reports usage, quota and persistence", async () => {
    expect(await getStorageStatus()).toEqual({ persisted: false, usage: 2048, quota: 1_000_000 });
  });

  it("degrades gracefully without the Storage API", async () => {
    vi.stubGlobal("navigator", {});
    expect(await getStorageStatus()).toEqual({ persisted: false, usage: null, quota: null });
  });
});
