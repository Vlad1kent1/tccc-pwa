import { CirculationTreatment, EvacPriority, Gender, OtherTreatment, type CardFields, type Limb } from "@tccc/shared";
import { tourniquetPlacement } from "../treatment-flags";
import type { Dd1380Values } from "../types";
import { formatCardDate, formatCardTime } from "./card-time";
import { AIRWAY, BREATHING, MECH } from "./checkbox-mapping";
import { LIMBS } from "./slots";
import { active } from "./values";

/**
 * The sheet's single "Last, First" name line. A first name on its own keeps the
 * comma (", Olena") so it reads back as a first name.
 */
export function cardNameLine(card: { lastName: string | null; firstName: string | null }): string {
  if (card.firstName && !card.lastName) return `, ${card.firstName}`;
  return [card.lastName, card.firstName].filter(Boolean).join(", ");
}

/**
 * Reads "Last, First" (the format printed on the card). Without a comma the whole
 * line is the last name, so a multi-word last name such as "Van Damme" stays whole.
 */
export function splitName(value: string): { lastName: string | null; firstName: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { lastName: null, firstName: null };
  const comma = trimmed.indexOf(",");
  if (comma < 0) return { lastName: trimmed, firstName: null };
  return {
    lastName: trimmed.slice(0, comma).trim() || null,
    firstName: trimmed.slice(comma + 1).trim() || null,
  };
}

/** What the sheet shows: a stored card, or the board store's snapshot of one. */
export type SheetSource = Pick<
  CardFields,
  | "lastName"
  | "firstName"
  | "gender"
  | "injuredAt"
  | "battleRosterNumber"
  | "evacPriority"
  | "allergies"
  | "casualtyLast4"
  | "service"
  | "unit"
  | "mechanisms"
  | "mechanismOther"
  | "notes"
  | "responderName"
  | "responderLast4"
  | "circulation"
  | "airway"
  | "breathing"
  | "otherTreatments"
  | "tqExtremity"
  | "tqJunctional"
  | "tqTruncal"
  | "dressingOtherType"
  | "circulationTqType"
  | "circulationDressingType"
  | "airwayType"
  | "breathingType"
  | "combatPillPack"
  | "eyeShieldRight"
  | "eyeShieldLeft"
  | "hypothermiaType"
> & {
  tourniquets: readonly { limb: Limb; type: string; appliedAt: string; deletedAt: string | null }[];
  injurySites: readonly { siteCode: string | null; deletedAt: string | null }[];
};

export function cardToValues(card: SheetSource): Dd1380Values {
  const placement = tourniquetPlacement(card);
  const values: Record<string, string | boolean> = {};
  values.name = cardNameLine(card);
  values.service = card.service ?? "";
  values.unit = card.unit ?? "";
  values.last4 = card.casualtyLast4 ?? "";
  if (card.gender === Gender.MALE) values.male = true;
  if (card.gender === Gender.FEMALE) values.female = true;
  values.date = formatCardDate(card.injuredAt);
  values.time = formatCardTime(card.injuredAt);
  values.roster = card.battleRosterNumber ?? "";
  if (card.evacPriority === EvacPriority.URGENT) values.evac_urgent = true;
  if (card.evacPriority === EvacPriority.PRIORITY) values.evac_priority = true;
  if (card.evacPriority === EvacPriority.ROUTINE) values.evac_routine = true;
  values.allergies = card.allergies ?? "";
  for (const [name, mech] of MECH) {
    if (card.mechanisms.includes(mech)) values[name] = true;
  }
  values.mechanism_specify = card.mechanismOther ?? "";
  values.notes = card.notes ?? "";
  values.firstResponder_name = card.responderName ?? "";
  values.firstResponder_last4 = card.responderLast4 ?? "";

  if (placement.tqExtremity) values.treatment_C_TQ_Extremity = true;
  if (placement.tqJunctional) values.treatment_C_TQ_Junctional = true;
  if (placement.tqTruncal) values.treatment_C_TQ_Truncal = true;
  if (card.circulation.includes(CirculationTreatment.HEMOSTATIC)) values.treatment_C_Dressing_Hemostatic = true;
  if (card.circulation.includes(CirculationTreatment.PRESSURE)) values.treatment_C_Dressing_Pressure = true;
  if (card.circulation.includes(CirculationTreatment.DRESSING)) values.treatment_C_Dressing_Other = true;
  if (card.dressingOtherType) values.treatment_C_Dressing_other_specify = card.dressingOtherType;
  if (card.circulationTqType) values.treatment_C_TQ_type = card.circulationTqType;
  if (card.circulationDressingType) values.treatment_C_Dressing_type = card.circulationDressingType;
  if (card.airwayType) values.treatment_A_type = card.airwayType;
  if (card.breathingType) values.treatment_B_type = card.breathingType;
  for (const [name, item] of AIRWAY) {
    if (card.airway.includes(item)) values[name] = true;
  }
  for (const [name, item] of BREATHING) {
    if (card.breathing.includes(item)) values[name] = true;
  }
  if (card.combatPillPack) values.treatment_other_CombatPillPack = true;
  if (card.eyeShieldRight || card.eyeShieldLeft || card.otherTreatments.includes(OtherTreatment.EYE_SHIELD)) {
    values.treatment_other_EyeShield = true;
  }
  if (card.eyeShieldRight) values.treatment_other_R = true;
  if (card.eyeShieldLeft) values.treatment_other_L = true;
  if (card.otherTreatments.includes(OtherTreatment.SPLINT)) values.treatment_other_Splint = true;
  if (card.otherTreatments.includes(OtherTreatment.HYPOTHERMIA_PREVENTION)) {
    values.treatment_other_HypothermiaPrevention = true;
  }
  if (card.hypothermiaType) values.treatment_other_type = card.hypothermiaType;

  for (const [limb, prefix] of LIMBS) {
    const row = active(card.tourniquets).find((item) => item.limb === limb);
    if (row) {
      values[`${prefix}_type`] = row.type;
      values[`${prefix}_time`] = formatCardTime(row.appliedAt);
    }
  }

  for (const site of active(card.injurySites)) {
    if (site.siteCode) values[site.siteCode] = true;
  }

  return values;
}
