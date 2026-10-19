import { describe, expect, it } from "vitest";
import { MechanismOfInjury } from "@tccc/shared";
import { cleanCardPatch } from "./card-patch";

describe("cleanCardPatch", () => {
  it("turns blank and whitespace-only text into null", () => {
    expect(cleanCardPatch({ lastName: " ", notes: "\n", allergies: "" })).toEqual({
      patch: { lastName: null, notes: null, allergies: null },
      invalid: [],
    });
  });

  it("trims text it keeps", () => {
    expect(cleanCardPatch({ lastName: "  Melnyk " }).patch).toEqual({ lastName: "Melnyk" });
  });

  it("leaves an invalid field out and keeps the rest", () => {
    const result = cleanCardPatch({ allergies: "x".repeat(501), notes: "TQ left leg", mechanisms: [MechanismOfInjury.GSW] });
    expect(result.invalid).toEqual(["allergies"]);
    expect(result.patch).toEqual({ notes: "TQ left leg", mechanisms: [MechanismOfInjury.GSW] });
  });

  it("skips unknown keys and undefined values", () => {
    expect(cleanCardPatch({ toString: "x", paperExtras: {}, responderLast4: undefined })).toEqual({ patch: {}, invalid: [] });
  });
});
