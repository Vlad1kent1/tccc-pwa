import { describe, expect, it } from "vitest";
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, backoffDelayMs } from "./backoff";

describe("backoffDelayMs", () => {
  it("is zero when the random source returns zero", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(0);
    expect(backoffDelayMs(4, () => 0)).toBe(0);
  });

  it("doubles the ceiling per attempt and caps at 60s", () => {
    expect(backoffDelayMs(0, () => 1)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(1, () => 1)).toBe(2_000);
    expect(backoffDelayMs(2, () => 1)).toBe(4_000);
    expect(backoffDelayMs(6, () => 1)).toBe(BACKOFF_CAP_MS);
    expect(backoffDelayMs(10, () => 1)).toBe(BACKOFF_CAP_MS);
  });

  it("draws a delay inside the full jitter range", () => {
    expect(backoffDelayMs(1, () => 0.5)).toBe(1_000);
  });
});
