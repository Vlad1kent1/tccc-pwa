import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./unit-token", () => ({ readUnitToken: async () => "unit-token" }));

import { fetchHealth, isRetryableError, pullChanges, SYNC_REQUEST_TIMEOUT_MS } from "./api";

/** A fetch that never answers and rejects only once its signal aborts, like a hung server. */
function hangingFetch() {
  const fetch = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sync requests", () => {
  it("give up on a request nobody answers, with an error the engine retries", async () => {
    hangingFetch();
    const pending = pullChanges("0").catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(SYNC_REQUEST_TIMEOUT_MS);

    const error = await pending;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("TimeoutError");
    expect(isRetryableError(error)).toBe(true);
  });

  it("stop when the caller aborts first", async () => {
    hangingFetch();
    const controller = new AbortController();
    const pending = fetchHealth(controller.signal).catch((error: unknown) => error);
    controller.abort();

    const error = await pending;
    expect((error as DOMException).name).toBe("AbortError");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clear the deadline once the response is read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "ok", db: "ok", serverTime: "2026-10-19T12:00:00.000Z" }))),
    );

    await expect(fetchHealth()).resolves.toMatchObject({ db: "ok" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
