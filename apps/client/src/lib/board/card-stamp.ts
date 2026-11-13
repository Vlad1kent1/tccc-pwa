import { CirculationTreatment, EvacPriority, Gender, OtherTreatment } from "@tccc/shared";
import { AIRWAY, BREATHING, MECH, TQ_BOXES, on, parseDdMmmYy, parseHmm, splitName, str, type Dd1380Values } from "@tccc/dd1380";
import { timeTokenToIso, type TimeAnchor } from "@/lib/forms/time";

/**
 * A paper date (`DD-MMM-YY`) and time box (`HHMM`). A blank or unfinished time, or an
 * unfinished date, gives null: no midnight is made up. With no date, the time is
 * placed by `timeTokenToIso` (most recent past occurrence, or the occurrence nearest
 * to `anchor.near` when correcting a stored time).
 */
export function parseCardStamp(dateText: string, timeText: string, anchor: TimeAnchor = {}): string | null {
  const time = parseHmm(timeText);
  if (!time) return null;
  if (!dateText.trim()) return timeTokenToIso(timeText.trim(), anchor);
  const date = parseDdMmmYy(dateText);
  if (!date) return null;
  date.setHours(time.hours, time.minutes, 0, 0);
  return date.toISOString();
}

export function valuesToCardPatch(values: Dd1380Values) {
  const { lastName, firstName } = splitName(str(values.name));
  const mechanisms = MECH.filter(([name]) => on(values, name)).map(([, mech]) => mech);
  const circulation: CirculationTreatment[] = [];
  if (TQ_BOXES.some((name) => on(values, name))) circulation.push(CirculationTreatment.TOURNIQUET);
  if (on(values, "treatment_C_Dressing_Hemostatic")) circulation.push(CirculationTreatment.HEMOSTATIC);
  if (on(values, "treatment_C_Dressing_Pressure")) circulation.push(CirculationTreatment.PRESSURE);
  if (on(values, "treatment_C_Dressing_Other")) circulation.push(CirculationTreatment.DRESSING);
  const airway = AIRWAY.filter(([name]) => on(values, name)).map(([, item]) => item);
  const breathing = BREATHING.filter(([name]) => on(values, name)).map(([, item]) => item);
  const otherTreatments: OtherTreatment[] = [];
  if (on(values, "treatment_other_EyeShield") || on(values, "treatment_other_R") || on(values, "treatment_other_L")) {
    otherTreatments.push(OtherTreatment.EYE_SHIELD);
  }
  if (on(values, "treatment_other_Splint")) otherTreatments.push(OtherTreatment.SPLINT);
  if (on(values, "treatment_other_HypothermiaPrevention")) otherTreatments.push(OtherTreatment.HYPOTHERMIA_PREVENTION);

  let evacPriority: EvacPriority | null = null;
  if (on(values, "evac_urgent")) evacPriority = EvacPriority.URGENT;
  else if (on(values, "evac_priority")) evacPriority = EvacPriority.PRIORITY;
  else if (on(values, "evac_routine")) evacPriority = EvacPriority.ROUTINE;

  let gender: Gender | null = null;
  if (on(values, "male")) gender = Gender.MALE;
  else if (on(values, "female")) gender = Gender.FEMALE;

  return {
    lastName,
    firstName,
    gender,
    injuredAt: injuryStamp(values),
    battleRosterNumber: str(values.roster).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 20) || null,
    evacPriority,
    allergies: str(values.allergies).trim() || null,
    // Digits as typed: the board store holds a partial last 4 back until all four are in.
    casualtyLast4: digits4(values.last4),
    service: line(values, "service"),
    unit: line(values, "unit"),
    mechanisms,
    mechanismOther: str(values.mechanism_specify).trim() || null,
    circulation,
    airway,
    breathing,
    otherTreatments,
    notes: str(values.notes).trim() || null,
    responderName: str(values.firstResponder_name).trim() || null,
    responderLast4: digits4(values.firstResponder_last4),
    tqExtremity: on(values, "treatment_C_TQ_Extremity"),
    tqJunctional: on(values, "treatment_C_TQ_Junctional"),
    tqTruncal: on(values, "treatment_C_TQ_Truncal"),
    dressingOtherType: line(values, "treatment_C_Dressing_other_specify"),
    circulationTqType: line(values, "treatment_C_TQ_type"),
    circulationDressingType: line(values, "treatment_C_Dressing_type"),
    airwayType: line(values, "treatment_A_type"),
    breathingType: line(values, "treatment_B_type"),
    combatPillPack: on(values, "treatment_other_CombatPillPack"),
    eyeShieldRight: on(values, "treatment_other_R"),
    eyeShieldLeft: on(values, "treatment_other_L"),
    hypothermiaType: line(values, "treatment_other_type"),
  };
}

/**
 * Null when both boxes are empty (cleared). `undefined` while the time is missing or
 * unfinished: the injury time is then left as stored instead of being saved at midnight.
 */
function injuryStamp(values: Dd1380Values): string | null | undefined {
  const date = str(values.date).trim();
  const time = str(values.time).trim();
  if (!date && !time) return null;
  return parseCardStamp(date, time) ?? undefined;
}

function digits4(value: Dd1380Values[string] | undefined): string | null {
  return str(value).replace(/\D/g, "").slice(0, 4) || null;
}

/** One short text line of the sheet, as stored: trimmed, capped at 100, blank as null. */
function line(values: Dd1380Values, name: string): string | null {
  return str(values[name]).trim().slice(0, 100) || null;
}
