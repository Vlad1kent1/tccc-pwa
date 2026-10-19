import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TcccDB } from "@/lib/db/schema";
import { ApiError } from "./api";
import { BACKOFF_CAP_MS } from "./backoff";
import type { Connectivity } from "./connectivity";
import { connectivityMode, getSyncSnapshot, patchSyncStatus } from "./status-store";

const probeConnectivity = vi.fn(async (..._args: unknown[]): Promise<Connectivity> => "online");
const pushOutbox = vi.fn();
const pullAll = vi.fn(async (..._args: unknown[]): Promise<void> => undefined);

vi.mock("./connectivity", () => ({
  probeConnectivity: (...args: unknown[]) => probeConnectivity(...args),
}));

vi.mock("./pipeline", () => ({
  pushOutbox: (...args: unknown[]) => pushOutbox(...args),
  pullAll: (...args: unknown[]) => pullAll(...args),
}));

const readUnitToken = vi.fn(async (): Promise<string | null> => "unit-token");

vi.mock("./unit-token", () => ({
  readUnitToken: () => readUnitToken(),
}));

import { resetSyncBackoff, resumeAfterTokenChange, syncNow } from "./engine";

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
  readUnitToken.mockReset().mockResolvedValue("unit-token");
  resetSyncBackoff();
  patchSyncStatus({
    state: "idle",
    connectivity: "online",
    pendingCount: 0,
    lastSyncAt: null,
    lastError: null,
    conflictCount: 0,
    authProblem: null,
  });
});

afterEach(async () => {
  // A retry scheduled by one test must not fire in the next one.
  resetSyncBackoff();
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

describe("automatic retry", () => {
  type OnRetry = (retry: { attempts: number; message: string; status?: number | null }) => void;
  /** Past the longest backoff, so a scheduled retry has fired. */
  const AFTER_BACKOFF_MS = BACKOFF_CAP_MS + 1_000;

  beforeEach(() => {
    // fake-indexeddb schedules with setImmediate, which stays real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes again on its own when the backoff after a 5xx ends", async () => {
    pushOutbox
      .mockImplementationOnce(async (_db: TcccDB, onRetry?: OnRetry) => {
        onRetry?.({ attempts: 1, message: "POST /api/sync/push failed (503)", status: 503 });
        return "retry" as const;
      })
      .mockResolvedValue("ok");

    await syncNow(db);
    expect(getSyncSnapshot()).toMatchObject({ state: "degraded", lastError: { status: 503 } });
    expect(pullAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AFTER_BACKOFF_MS);
    expect(pushOutbox).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot()).toMatchObject({ state: "online", lastError: null });
  });

  it("retries a pull that failed with a 5xx", async () => {
    pushOutbox.mockResolvedValue("ok");
    pullAll.mockRejectedValueOnce(new ApiError(500, "GET /api/sync/pull failed (500)"));

    await syncNow(db);
    expect(getSyncSnapshot()).toMatchObject({ state: "degraded", lastError: { status: 500 } });

    await vi.advanceTimersByTimeAsync(AFTER_BACKOFF_MS);
    expect(pullAll).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().state).toBe("online");
  });

  it("probes again after a failed health check while the browser is online", async () => {
    probeConnectivity.mockResolvedValueOnce("offline");
    pushOutbox.mockResolvedValue("ok");

    await syncNow(db);
    expect(getSyncSnapshot().state).toBe("offline");

    await vi.advanceTimersByTimeAsync(AFTER_BACKOFF_MS);
    expect(probeConnectivity).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().state).toBe("online");
  });

  it("leaves a dropped network to the online event", async () => {
    setOnline(false);
    probeConnectivity.mockResolvedValue("offline");

    await syncNow(db);
    await vi.advanceTimersByTimeAsync(AFTER_BACKOFF_MS);
    expect(probeConnectivity).toHaveBeenCalledTimes(1);
  });

  it("cancels the scheduled retry once a sync succeeds", async () => {
    pushOutbox
      .mockImplementationOnce(async (_db: TcccDB, onRetry?: OnRetry) => {
        onRetry?.({ attempts: 1, message: "down" });
        return "retry" as const;
      })
      .mockResolvedValue("ok");

    await syncNow(db);
    await syncNow(db, { manual: true });
    expect(pushOutbox).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(AFTER_BACKOFF_MS);
    expect(pushOutbox).toHaveBeenCalledTimes(2);
  });

  it("still pulls while some mutations wait for a retry, and reports degraded until they are sent", async () => {
    pushOutbox
      .mockImplementationOnce(async (_db: TcccDB, onRetry?: OnRetry) => {
        onRetry?.({ attempts: 1, message: "INTERNAL: Server could not apply the mutation" });
        return "partial" as const;
      })
      .mockResolvedValue("ok");

    await syncNow(db);
    expect(pullAll).toHaveBeenCalledTimes(1);
    expect(getSyncSnapshot()).toMatchObject({
      state: "degraded",
      lastError: { message: "INTERNAL: Server could not apply the mutation", status: null },
    });

    await vi.advanceTimersByTimeAsync(AFTER_BACKOFF_MS);
    expect(pushOutbox).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot()).toMatchObject({ state: "online", lastError: null });
  });
});

describe("unit token", () => {
  it("sends nothing without a token and reports it as missing", async () => {
    readUnitToken.mockResolvedValue(null);
    await syncNow(db);
    expect(pushOutbox).not.toHaveBeenCalled();
    expect(pullAll).not.toHaveBeenCalled();
    expect(getSyncSnapshot()).toMatchObject({ state: "degraded", authProblem: "missing" });
  });

  it("pauses automatic sync after a 401 until the token changes", async () => {
    pushOutbox.mockRejectedValueOnce(new ApiError(401, "POST /api/sync/push failed (401)"));
    await syncNow(db);
    expect(getSyncSnapshot()).toMatchObject({ state: "degraded", authProblem: "rejected", lastError: { status: 401 } });

    pushOutbox.mockResolvedValue("ok");
    await syncNow(db);
    expect(pushOutbox).toHaveBeenCalledTimes(1);

    await resumeAfterTokenChange(db);
    expect(pushOutbox).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot()).toMatchObject({ state: "online", authProblem: null, lastError: null });
  });

  it("lets Sync now retry a refused token, e.g. after the server was fixed", async () => {
    pushOutbox.mockRejectedValueOnce(new ApiError(401, "refused")).mockResolvedValue("ok");
    await syncNow(db);
    await syncNow(db, { manual: true });
    expect(pushOutbox).toHaveBeenCalledTimes(2);
    expect(getSyncSnapshot().authProblem).toBeNull();
  });

  it("pauses on a 401 from the pull as well", async () => {
    pushOutbox.mockResolvedValue("ok");
    pullAll.mockRejectedValueOnce(new ApiError(401, "GET /api/sync/pull failed (401)"));
    await syncNow(db);
    expect(getSyncSnapshot().authProblem).toBe("rejected");
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
