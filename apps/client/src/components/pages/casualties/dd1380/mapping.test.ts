import { describe, expect, it } from "vitest";
import { EvacPriority, Gender, MechanismOfInjury } from "@tccc/shared";
import { cardNameLine, formatCardDate, formatCardTime, parseCardStamp, splitName, valuesToCardPatch } from "@/components/pages/casualties/dd1380/mapping";

describe("DD Form 1380 mapping", () => {
  it("formats the paper date and time from an ISO stamp", () => {
    const iso = new Date(2026, 9, 1, 14, 5).toISOString();
    expect(formatCardDate(iso)).toBe("01-OCT-26");
    expect(formatCardTime(iso)).toBe("1405");
  });

  it("parses DD-MMM-YY and HHmm back to a timestamp", () => {
    const iso = parseCardStamp("01-OCT-26", "1405");
    expect(iso).toBeTruthy();
    const date = new Date(iso!);
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(9);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(5);
  });

  it("maps identity, EVAC, and mechanism checkboxes onto card fields", () => {
    const patch = valuesToCardPatch({
      name: "Doe, John",
      male: true,
      roster: "JD1234",
      evac_urgent: true,
      allergies: "NKDA",
      mechanism_gsw: true,
      mechanism_other: true,
      mechanism_specify: "blast",
      firstResponder_name: "Medic, A",
      firstResponder_last4: "9876",
    });
    expect(patch.lastName).toBe("Doe");
    expect(patch.firstName).toBe("John");
    expect(patch.gender).toBe(Gender.MALE);
    expect(patch.battleRosterNumber).toBe("JD1234");
    expect(patch.evacPriority).toBe(EvacPriority.URGENT);
    expect(patch.allergies).toBe("NKDA");
    expect(patch.mechanisms).toEqual([MechanismOfInjury.GSW, MechanismOfInjury.OTHER]);
    expect(patch.mechanismOther).toBe("blast");
    expect(patch.responderLast4).toBe("9876");
  });

  it("returns null for a blank or unfinished time instead of midnight", () => {
    expect(parseCardStamp("", "")).toBeNull();
    expect(parseCardStamp("01-OCT-26", "")).toBeNull();
    expect(parseCardStamp("", "14")).toBeNull();
    expect(parseCardStamp("01-OC", "1405")).toBeNull();
  });

  it("places a time without a date at its most recent past occurrence", () => {
    const now = new Date(2026, 9, 8, 0, 10);
    expect(parseCardStamp("", "2350", { now })).toBe(new Date(2026, 9, 7, 23, 50).toISOString());
    expect(parseCardStamp("", "0005", { now })).toBe(new Date(2026, 9, 8, 0, 5).toISOString());
  });

  it("keeps the stored day when correcting a time across midnight", () => {
    const now = new Date(2026, 9, 8, 0, 20);
    const near = new Date(2026, 9, 7, 23, 58).toISOString();
    expect(parseCardStamp("", "0005", { now, near })).toBe(new Date(2026, 9, 8, 0, 5).toISOString());
    expect(parseCardStamp("", "2355", { now, near })).toBe(new Date(2026, 9, 7, 23, 55).toISOString());
  });

  it("leaves the injury time unsaved while only the date is filled in", () => {
    expect(valuesToCardPatch({ date: "01-OCT-26", time: "" }).injuredAt).toBeUndefined();
    expect(valuesToCardPatch({ date: "", time: "" }).injuredAt).toBeNull();
  });

  it("round-trips names through the single name line", () => {
    for (const name of [
      { lastName: "Van Damme", firstName: null },
      { lastName: "Doe", firstName: "John" },
      { lastName: "De la Cruz", firstName: "Maria Elena" },
      { lastName: null, firstName: "Olena" },
      { lastName: null, firstName: null },
    ]) {
      expect(splitName(cardNameLine(name))).toEqual(name);
    }
  });
});

