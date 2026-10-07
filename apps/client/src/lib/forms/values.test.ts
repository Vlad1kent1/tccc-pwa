import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso } from "./time";
import { normalizeForm, responderPatch } from "./values";

describe("form values", () => {
  it("trims text and maps blank strings to null", () => {
    expect(normalizeForm({ lastName: "  Koval  ", battleRosterNumber: "   ", mechanisms: ["GSW"] })).toEqual({
      lastName: "Koval",
      battleRosterNumber: null,
      mechanisms: ["GSW"],
    });
  });

  it("copies only a valid responder profile", () => {
    expect(responderPatch({ name: "  Ivanenko ", last4: "1234" })).toEqual({
      responderName: "Ivanenko",
      responderLast4: "1234",
    });
    expect(responderPatch({ name: " ", last4: "12" })).toEqual({});
    expect(responderPatch(undefined)).toEqual({});
  });

  it("round-trips an ISO time through a datetime-local value", () => {
    const iso = "2026-09-26T08:15:00.000Z";
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
  });
});
