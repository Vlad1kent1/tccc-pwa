import { describe, expect, it } from "vitest";
import { applyNowStamp, formatHmm, joinDateAndTime, lastTimeToken, maskHmm, sameMinute, timeTokenToIso } from "./time";

const NOW = new Date(2026, 9, 7, 14, 35, 0);

describe("time stamps", () => {
  it("formats local hours and minutes", () => {
    expect(formatHmm(NOW.toISOString())).toBe("1435");
  });

  it("replaces a time box with the current time", () => {
    expect(applyNowStamp("", NOW)).toBe("1435");
    expect(applyNowStamp("0930", NOW)).toBe("1435");
    expect(applyNowStamp("given 12ab", NOW)).toBe("1435");
  });

  it("keeps a time box to four digits", () => {
    expect(maskHmm("12a45!!")).toBe("1245");
    expect(maskHmm("124599")).toBe("1245");
    expect(maskHmm("")).toBe("");
  });

  it("reads the latest time token", () => {
    expect(lastTimeToken("0930 1435")).toBe("1435");
    expect(lastTimeToken("14:05")).toBe("14:05");
  });

  it("joins a date with the latest time token", () => {
    const iso = joinDateAndTime("2026-10-07", "0930 1435", null, NOW);
    expect(iso).toBeTruthy();
    const date = new Date(iso!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(9);
    expect(date.getDate()).toBe(7);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(35);
  });
});

/** Local wall-clock instant, so the tests read the same in any time zone. */
function local(day: number, hours: number, minutes: number, seconds = 0): Date {
  return new Date(2026, 9, day, hours, minutes, seconds);
}

function iso(day: number, hours: number, minutes: number): string {
  return local(day, hours, minutes).toISOString();
}

describe("timeTokenToIso: most recent past occurrence", () => {
  it("places a late-evening time typed just after midnight on the previous day", () => {
    expect(timeTokenToIso("2350", { now: local(8, 0, 10) })).toBe(iso(7, 23, 50));
  });

  it("keeps a time earlier today on today", () => {
    expect(timeTokenToIso("2350", { now: local(7, 23, 55) })).toBe(iso(7, 23, 50));
    expect(timeTokenToIso("0005", { now: local(8, 0, 10) })).toBe(iso(8, 0, 5));
  });

  it("allows a few minutes ahead of the device clock", () => {
    expect(timeTokenToIso("1405", { now: local(7, 14, 0) })).toBe(iso(7, 14, 5));
    expect(timeTokenToIso("0015", { now: local(8, 0, 10) })).toBe(iso(8, 0, 15));
  });

  it("takes a time well ahead of now as yesterday's", () => {
    expect(timeTokenToIso("1430", { now: local(7, 14, 0) })).toBe(iso(6, 14, 30));
  });

  it("accepts H:MM and HMM", () => {
    expect(timeTokenToIso("9:05", { now: local(7, 14, 0) })).toBe(iso(7, 9, 5));
    expect(timeTokenToIso("905", { now: local(7, 14, 0) })).toBe(iso(7, 9, 5));
  });

  it("returns null for a blank or unfinished time instead of midnight", () => {
    expect(timeTokenToIso("", { now: local(7, 14, 0) })).toBeNull();
    expect(timeTokenToIso("14", { now: local(7, 14, 0) })).toBeNull();
    expect(timeTokenToIso("2460", { now: local(7, 14, 0) })).toBeNull();
  });
});

describe("timeTokenToIso: correcting a stored time", () => {
  it("moves a time forward across midnight when that is nearer the stored value", () => {
    expect(timeTokenToIso("0005", { now: local(8, 0, 20), near: iso(7, 23, 58) })).toBe(iso(8, 0, 5));
  });

  it("moves a time back across midnight when that is nearer the stored value", () => {
    expect(timeTokenToIso("2355", { now: local(8, 0, 20), near: iso(8, 0, 2) })).toBe(iso(7, 23, 55));
  });

  it("keeps the day of an older row", () => {
    expect(timeTokenToIso("1030", { now: local(9, 12, 0), near: iso(5, 10, 0) })).toBe(iso(5, 10, 30));
  });

  it("never lands beyond the future allowance", () => {
    expect(timeTokenToIso("0100", { now: local(8, 0, 20), near: iso(8, 0, 10) })).toBe(iso(7, 1, 0));
  });
});

describe("timeTokenToIso: cross-check with the injury time", () => {
  it("moves a result before the injury forward a day when that is not in the future", () => {
    const placed = timeTokenToIso("0030", { now: local(8, 1, 0), near: iso(7, 0, 20), notBefore: iso(8, 0, 5) });
    expect(placed).toBe(iso(8, 0, 30));
  });

  it("keeps a time before the injury as typed when moving it would put it in the future", () => {
    expect(timeTokenToIso("1330", { now: local(7, 15, 0), notBefore: iso(7, 14, 0) })).toBe(iso(7, 13, 30));
  });
});

describe("joinDateAndTime", () => {
  it("clears with both boxes empty", () => {
    expect(joinDateAndTime("", "", iso(7, 9, 0), NOW)).toBeNull();
  });

  it("saves nothing while the time is missing or unfinished", () => {
    expect(joinDateAndTime("2026-10-07", "", null, NOW)).toBeUndefined();
    expect(joinDateAndTime("2026-10-07", "14", null, NOW)).toBeUndefined();
  });

  it("places a time without a date at its most recent past occurrence", () => {
    expect(joinDateAndTime("", "2350", null, local(8, 0, 10))).toBe(iso(7, 23, 50));
  });
});

describe("sameMinute", () => {
  it("ignores seconds", () => {
    expect(sameMinute(local(7, 8, 15, 42).toISOString(), iso(7, 8, 15))).toBe(true);
    expect(sameMinute(iso(7, 8, 15), iso(7, 8, 16))).toBe(false);
    expect(sameMinute(null, null)).toBe(true);
  });
});
