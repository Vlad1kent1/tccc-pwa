import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TcccDB } from "@/lib/db/schema";
import { ApiError } from "./api";
import { connectivityMode, getSyncSnapshot, patchSyncStatus } from "./status-store";

const probeConnectivity = vi.fn(async () => "online" as const);
const pushOutbox = vi.fn();
const pullAll = vi.fn(async () => undefined);

vi.mock("./connectivity", () => ({
  probeConnectivity: (...args: unknown[]) => probeConnectivity(...args),
}));

vi.mock("./pipeline", () => ({
  pushOutbox: (...args: unknown[]) => pushOutbox(...args),
  pullAll: (...args: unknown[]) => pullAll(...args),
}));

import { resetSyncBackoff, syncNow } from "./engine";

let db: TcccDB;

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(() => {
  db = new TcccDB(`tccc-sync-${crypto.randomUUID()}`);
  setOnline(true);
  probeConnectivity.mockReset().mockResolvedValue("online");
  pushOutbox.mockReset();
  pullAll.mockClear();
  resetSyncBackoff();
  patchSyncStatus({
    state: "idle",
    connectivity: "online",
    pendingCount: 0,
    lastSyncAt: null,
    lastError: null,
    conflictCount: 0,
  });
});

afterEach(async () => {
  setOnline(true);
  await db.delete();
});

describe("syncNow", () => {
  it("runs a forced pass when Sync now arrives during a backoff cycle", async () => {
    let calls = 0;
    let releaseFirst: () => void = () => undefined;
    pushOutbox.mockImplementation(async (_db: TcccDB, onRetry?: (retry: { attempts: number; message: string }) => void) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<"retry">((resolve) => {
          releaseFirst = () => {
            onRetry?.({ attempts: 2, message: "down" });
            resolve("retry");
          };
        });
      }
      return "ok" as const;
    });

    const first = syncNow(db);
    await vi.waitFor(() => expect(calls).toBe(1));
    const joined = syncNow(db, { manual: true });
    expect(joined).toBe(first);
    releaseFirst();
    await first;
    expect(calls).toBe(2);
  });

  it("does not push again while backoff is active and nobody asked to sync now", async () => {
    pushOutbox.mockImplementation(async (_db: TcccDB, onRetry?: (retry: { attempts: number; message: string }) => void) => {
      onRetry?.({ attempts: 2, message: "down" });
      return "retry" as const;
    });
    await syncNow(db);
    await syncNow(db);
    expect(pushOutbox).toHaveBeenCalledTimes(1);
  });

  it("stores a retryable push failure as degraded while the browser is online", async () => {
    pushOutbox.mockImplementation(async (_db: TcccDB, onRetry?: (retry: { attempts: number; message: string }) => void) => {
      onRetry?.({ attempts: 1, message: "503" });
      return "retry" as const;
    });
    await syncNow(db, { manual: true });
    expect(getSyncSnapshot()).toMatchObject({
      state: "degraded",
      connectivity: "online",
      lastError: { message: "503", status: null },
    });
  });

  it("maps an HTTP 4xx response to degraded with the status on lastError", async () => {
    pushOutbox.mockRejectedValue(new ApiError(422, "POST /api/sync/push failed (422)"));
    await syncNow(db, { manual: true });
    expect(getSyncSnapshot()).toMatchObject({
      state: "degraded",
      connectivity: "online",
      lastError: { message: "POST /api/sync/push failed (422)", status: 422 },
    });
  });

  it("maps a non-retryable failure to degraded", async () => {
    pushOutbox.mockRejectedValue(new Error("schema mismatch"));
    await syncNow(db, { manual: true });
    expect(getSyncSnapshot()).toMatchObject({
      state: "degraded",
      lastError: { message: "schema mismatch", status: null },
    });
  });

  it("keeps offline for a failed connectivity probe", async () => {
    probeConnectivity.mockResolvedValue("offline");
    await syncNow(db, { manual: true });
    expect(getSyncSnapshot().state).toBe("offline");
    expect(pushOutbox).not.toHaveBeenCalled();
  });

  it("maps a thrown network error to offline only when the browser is offline", async () => {
    setOnline(false);
    pushOutbox.mockRejectedValue(new TypeError("Failed to fetch"));
    await syncNow(db, { manual: true });
    expect(getSyncSnapshot()).toMatchObject({
      state: "offline",
      connectivity: "offline",
      lastError: { message: "Failed to fetch", status: null },
    });
  });
});

describe("connectivityMode", () => {
  it("shows degraded for an API failure and offline only for a dropped network", () => {
    expect(connectivityMode({ state: "degraded", connectivity: "online" })).toBe("degraded");
    expect(connectivityMode({ state: "unknown", connectivity: "unknown" })).toBe("degraded");
    expect(connectivityMode({ state: "offline", connectivity: "offline" })).toBe("offline");
    expect(connectivityMode({ state: "online", connectivity: "online" })).toBe("online");
    expect(connectivityMode({ state: "syncing", connectivity: "online" })).toBe("syncing");
  });
});
