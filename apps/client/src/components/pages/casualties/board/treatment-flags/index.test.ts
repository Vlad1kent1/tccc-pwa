import { CirculationTreatment, OtherTreatment, emptyCardFields } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import { reconcileTreatments, tourniquetPlacement } from "./index";

const empty = emptyCardFields();

describe("treatment flags", () => {
  it("adds the tourniquet flag for a placement and removes it with the last one", () => {
    const on = reconcileTreatments(empty, { ...empty, tqJunctional: true });
    expect(on.circulation).toEqual([CirculationTreatment.TOURNIQUET]);
    const off = reconcileTreatments(on, { ...on, tqJunctional: false });
    expect(off.circulation).toEqual([]);
  });

  it("adds the eye-shield flag for either eye", () => {
    const next = reconcileTreatments(empty, { ...empty, eyeShieldLeft: true });
    expect(next.otherTreatments).toEqual([OtherTreatment.EYE_SHIELD]);
  });

  it("keeps a flag set without checkboxes when another field changes", () => {
    const legacy = {
      ...empty,
      circulation: [CirculationTreatment.TOURNIQUET],
      otherTreatments: [OtherTreatment.EYE_SHIELD],
    };
    const next = reconcileTreatments(legacy, { ...legacy, combatPillPack: true });
    expect(next.circulation).toEqual([CirculationTreatment.TOURNIQUET]);
    expect(next.otherTreatments).toEqual([OtherTreatment.EYE_SHIELD]);
  });

  it("shows a tourniquet without placement as extremity", () => {
    expect(tourniquetPlacement({ ...empty, circulation: [CirculationTreatment.TOURNIQUET] }).tqExtremity).toBe(true);
    expect(tourniquetPlacement({ ...empty, circulation: [CirculationTreatment.TOURNIQUET], tqTruncal: true })).toEqual({
      tqExtremity: false,
      tqJunctional: false,
      tqTruncal: true,
    });
  });
});
