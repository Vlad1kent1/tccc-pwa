import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH_TIMEOUT_MS, probeConnectivity } from "./connectivity";

beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

describe("probeConnectivity", () => {
  it("reports unknown when the health probe exceeds the Field 2G budget", async () => {
    vi.useFakeTimers();
    const pending = probeConnectivity(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    await expect(pending).resolves.toBe("unknown");
  });

  it("reports offline when the probe fails before the budget", async () => {
    await expect(probeConnectivity(() => Promise.reject(new TypeError("network down")))).resolves.toBe("offline");
  });

  it("reports online when the server answers inside the budget", async () => {
    await expect(probeConnectivity(() => Promise.resolve({ db: "ok" }))).resolves.toBe("online");
  });
});
