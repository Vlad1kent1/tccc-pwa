import { sectionASchema } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import { createCasualtyRepo } from "@/lib/db";
import { TcccDB } from "@/lib/db/schema";
import { isoToLocalInput, localInputToIso } from "./time";
import { normalizeForm, persistSection, responderPatch } from "./values";

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

  it("stores valid fields when another field on the step is invalid", async () => {
    const db = new TcccDB(`tccc-test-${crypto.randomUUID()}`);
    const repo = createCasualtyRepo(db);
    try {
      const card = await repo.create();
      const saved = await persistSection(repo, card.id, sectionASchema, {
        lastName: "Shevchenko",
        firstName: null,
        gender: null,
        injuredAt: null,
        battleRosterNumber: "A-1",
        evacPriority: "URGENT",
        allergies: null,
      });

      expect(saved).toBe(false);
      const stored = await repo.getById(card.id);
      expect(stored?.lastName).toBe("Shevchenko");
      expect(stored?.evacPriority).toBe("URGENT");
      expect(stored?.battleRosterNumber).toBeNull();
    } finally {
      await db.delete();
    }
  });
});
