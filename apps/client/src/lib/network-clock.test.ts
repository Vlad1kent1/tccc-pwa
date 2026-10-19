import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeTokenToIso } from "@/lib/forms/time";
import { getNetworkAdjustedTime, setServerClockOffset } from "./network-clock";

describe("getNetworkAdjustedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setServerClockOffset(0);
    vi.useRealTimers();
  });

  it("adds the measured server offset to the device clock", () => {
    vi.setSystemTime(new Date(2026, 9, 16, 13, 5));
    setServerClockOffset(3_600_000);
    expect(getNetworkAdjustedTime()).toBe(new Date(2026, 9, 16, 14, 5).getTime());
  });

  it("ignores an offset that is not a number", () => {
    setServerClockOffset(Number.NaN);
    expect(getNetworkAdjustedTime()).toBe(Date.now());
  });

  it("places a typed time against server time when the phone clock runs an hour behind", () => {
    // Real time 14:05, phone shows 13:05. "1400" was five minutes ago, not yesterday.
    vi.setSystemTime(new Date(2026, 9, 16, 13, 5));
    setServerClockOffset(3_600_000);
    expect(timeTokenToIso("1400")).toBe(new Date(2026, 9, 16, 14, 0).toISOString());
  });
});
