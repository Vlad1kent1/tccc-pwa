import { describe, expect, it } from "vitest";
import { conflictNeedsReview } from "./conflict-policy.js";

describe("conflictNeedsReview", () => {
  it("blocks triage, allergies, deletion, and every clinical child row", () => {
    expect(conflictNeedsReview({ entity: "card", field: "evacPriority" })).toBe(true);
    expect(conflictNeedsReview({ entity: "card", field: "allergies" })).toBe(true);
    expect(conflictNeedsReview({ entity: "card", field: "deletedAt" })).toBe(true);
    expect(conflictNeedsReview({ entity: "tourniquet", field: "row" })).toBe(true);
    expect(conflictNeedsReview({ entity: "vitalSigns", field: "row" })).toBe(true);
    expect(conflictNeedsReview({ entity: "vitalSigns", field: "deletedAt" })).toBe(true);
    expect(conflictNeedsReview({ entity: "medication", field: "row" })).toBe(true);
    expect(conflictNeedsReview({ entity: "fluid", field: "row" })).toBe(true);
    expect(conflictNeedsReview({ entity: "injurySite", field: "row" })).toBe(true);
  });

  it("lets identity, narrative, and checkbox fields merge silently", () => {
    for (const field of ["lastName", "firstName", "notes", "mechanisms", "airway", "responderName"]) {
      expect(conflictNeedsReview({ entity: "card", field })).toBe(false);
    }
  });
});
