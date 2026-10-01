import { describe, expect, it } from "vitest";
import { EvacPriority, Gender, MechanismOfInjury } from "@tccc/shared";
import { formatCardDate, formatCardTime, parseCardStamp, valuesToCardPatch } from "./mapping";

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
});
