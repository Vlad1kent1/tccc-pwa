import { describe, expect, it } from "vitest";
import {
  applyNowStamp,
  formatHmm,
  isUnfinishedTime,
  joinDateAndTime,
  lastTimeToken,
  maskHmm,
  placeEditedTime,
  sameMinute,
  timeTokenToIso,
} from "./time";

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

  it("reads only complete time tokens, so a half-typed time is not a time (P0-001)", () => {
    expect(lastTimeToken("140")).toBe("");
    expect(lastTimeToken("905")).toBe("");
    expect(lastTimeToken("14:0")).toBe("");
    expect(lastTimeToken("9:05")).toBe("9:05");
    expect(lastTimeToken("0930 143")).toBe("0930");
    expect(lastTimeToken("21405")).toBe("");
    expect(lastTimeToken("123:45")).toBe("");
    expect(lastTimeToken("14:055")).toBe("");
  });

  it("keeps a time typed digit by digit on today when each save anchors the next (P0-001)", () => {
    const now = new Date(2026, 10, 10, 14, 10, 0);
    let stored: string | null = null;
    for (const text of ["1", "14", "140", "1405"]) {
      stored = timeTokenToIso(lastTimeToken(text), { now, near: stored, notBefore: null }) ?? stored;
    }
    expect(stored).toBe(new Date(2026, 10, 10, 14, 5, 0).toISOString());
  });

  it("flags a time box left with text that is not a complete time (P0-001)", () => {
    for (const text of ["905", "14", "1", "14:0", "2560", "0960", "0930 143", "14051"]) {
      expect(isUnfinishedTime(text), text).toBe(true);
    }
    for (const text of ["", "  ", "0905", "9:05", "14:05", "0930 1435", " 2350 "]) {
      expect(isUnfinishedTime(text), text).toBe(false);
    }
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

describe("placeEditedTime: a focused time box edit", () => {
  const editNow = new Date(2026, 10, 10, 23, 30, 0);
  const at = (day: number, hours: number, minutes: number) => new Date(2026, 10, day, hours, minutes, 0).toISOString();

  /** The tourniquet panel's loop: each keystroke saves, and the saved value becomes the row's time. */
  function typeOver(stored: string, startedWith: string | null | undefined, sequence: string[]): string {
    let current = stored;
    for (const text of sequence) current = placeEditedTime(text, startedWith, current, { now: editNow, notBefore: null }) ?? current;
    return current;
  }

  it("corrects 0105 through 2105 to 2305 against the time the edit started with", () => {
    const stored = at(10, 1, 5);
    expect(typeOver(stored, stored, ["2105"])).toBe(at(9, 21, 5));
    expect(typeOver(stored, stored, ["2105", "2305"])).toBe(at(9, 23, 5));
  });

  it("does not anchor a keystroke on the intermediate time an earlier keystroke saved (P0-001)", () => {
    // 2105 is saved as 9 Nov 21:05, nearest to 01:05. Anchored on that, 1205 would become 9 Nov 12:05,
    // a day before the 10 Nov 12:05 nearest to the 01:05 the edit started with.
    const stored = at(10, 1, 5);
    expect(typeOver(stored, stored, ["2105", "1205"])).toBe(at(10, 12, 5));
  });

  it("uses the live time outside a focused edit, and an empty start when the row had no time", () => {
    expect(placeEditedTime("2305", undefined, at(10, 22, 0), { now: editNow })).toBe(at(10, 23, 5));
    expect(placeEditedTime("2305", null, at(10, 22, 0), { now: editNow })).toBe(at(10, 23, 5));
  });
});
