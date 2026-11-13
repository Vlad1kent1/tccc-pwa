import { describe, expect, it } from "vitest";
import { formatCardDate, formatCardTime } from "../card-time";

describe("DD Form 1380 mapping", () => {
  it("formats the paper date and time from an ISO stamp", () => {
    const iso = new Date(2026, 9, 1, 14, 5).toISOString();
    expect(formatCardDate(iso)).toBe("01-OCT-26");
    expect(formatCardTime(iso)).toBe("1405");
  });
});
