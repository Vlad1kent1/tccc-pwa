import { CirculationTreatment, OtherTreatment, type CardFields } from "@tccc/shared";

type Flags = Pick<
  CardFields,
  "circulation" | "otherTreatments" | "tqExtremity" | "tqJunctional" | "tqTruncal" | "eyeShieldRight" | "eyeShieldLeft"
>;

function anyTourniquet(flags: Flags): boolean {
  return flags.tqExtremity || flags.tqJunctional || flags.tqTruncal;
}

function anyEye(flags: Flags): boolean {
  return flags.eyeShieldRight || flags.eyeShieldLeft;
}

function withFlag<T extends string>(list: T[], item: T, on: boolean): T[] {
  const has = list.includes(item);
  if (on === has) return list;
  return on ? [...list, item] : list.filter((entry) => entry !== item);
}

/**
 * Keeps the TOURNIQUET and EYE_SHIELD treatment flags in step with the paper
 * checkboxes under them. A flag changes only when a checkbox changes: ticking one
 * adds it, clearing the last one removes it. A card whose flag was set without any
 * checkbox (an older card) keeps its flag when unrelated fields are edited.
 */
export function reconcileTreatments<T extends Flags>(before: Flags, after: T): T {
  let next = after;
  if (anyTourniquet(after)) {
    next = { ...next, circulation: withFlag(next.circulation, CirculationTreatment.TOURNIQUET, true) };
  } else if (anyTourniquet(before)) {
    next = { ...next, circulation: withFlag(next.circulation, CirculationTreatment.TOURNIQUET, false) };
  }
  if (anyEye(after)) {
    next = { ...next, otherTreatments: withFlag(next.otherTreatments, OtherTreatment.EYE_SHIELD, true) };
  } else if (anyEye(before)) {
    next = { ...next, otherTreatments: withFlag(next.otherTreatments, OtherTreatment.EYE_SHIELD, false) };
  }
  if (next.circulation === after.circulation && next.otherTreatments === after.otherTreatments) return after;
  return next;
}

/**
 * Tourniquet placement as shown on the card. A card synced from a device without
 * placement checkboxes has TOURNIQUET only; limb tourniquets are extremity, and the
 * paper card has no box for TOURNIQUET by itself, so it is shown as Extremity.
 */
export function tourniquetPlacement(card: Pick<CardFields, "circulation" | "tqExtremity" | "tqJunctional" | "tqTruncal">) {
  const legacy =
    card.circulation.includes(CirculationTreatment.TOURNIQUET) && !card.tqExtremity && !card.tqJunctional && !card.tqTruncal;
  return {
    tqExtremity: card.tqExtremity || legacy,
    tqJunctional: card.tqJunctional,
    tqTruncal: card.tqTruncal,
  };
}
