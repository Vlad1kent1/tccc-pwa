import { Limb } from "@tccc/shared";
import type { Dd1380Values } from "../types";
import { str } from "./values";

/** Row counts printed on the DD1380 card. Edit stores more; the sheet shows the latest rows. */
export const PAPER_CAPACITY = {
  vitals: 4,
  fluid: 2,
  blood: 2,
  analgesic: 4,
  antibiotic: 2,
  otherMedication: 2,
} as const;

export const LIMBS: ReadonlyArray<readonly [Limb, string]> = [
  [Limb.RIGHT_ARM, "r_arm"],
  [Limb.LEFT_ARM, "l_arm"],
  [Limb.RIGHT_LEG, "r_leg"],
  [Limb.LEFT_LEG, "l_leg"],
];

/** Hidden form key for the vital row pinned to a column. Not a printed field. */
export function vitalSlotKey(slot: number): string {
  return `slotVital${slot}`;
}

/** Hidden form key for a fluid or medication row pinned to a line. */
export function slotKey(prefix: string, slot: number): string {
  return `slot:${prefix}:${slot}`;
}

export function limbSlots(values: Dd1380Values) {
  return LIMBS.map(([limb, prefix]) => ({
    limb,
    type: str(values[`${prefix}_type`]).trim(),
    time: str(values[`${prefix}_time`]),
  }));
}
