import {
  AirwayTreatment,
  Avpu,
  BodyRegion,
  BodyView,
  BreathingTreatment,
  CirculationTreatment,
  EvacPriority,
  Gender,
  Limb,
  MechanismOfInjury,
  OtherTreatment,
  Route,
} from "@tccc/shared";
import type { LocalCasualtyCard } from "@/lib/db";
import { timeTokenToIso, type TimeAnchor } from "@/lib/forms/time";
import type { Dd1380Values } from "@/components/pages/casualties/dd1380/form-context";
import { tourniquetPlacement } from "@/components/pages/casualties/board/treatment-flags";
import { ANTERIOR_SITES, POSTERIOR_SITES } from "@/components/pages/casualties/dd1380/injury-sites";

/** Row counts printed on the DD1380 card. Edit stores more; the sheet shows the latest rows. */
export const PAPER_CAPACITY = {
  vitals: 4,
  fluid: 2,
  blood: 2,
  analgesic: 4,
  antibiotic: 2,
  otherMedication: 2,
} as const;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

const MECH: ReadonlyArray<readonly [string, MechanismOfInjury]> = [
  ["mechanism_artillery", MechanismOfInjury.ARTILLERY],
  ["mechanism_blunt", MechanismOfInjury.BLUNT],
  ["mechanism_burn", MechanismOfInjury.BURN],
  ["mechanism_fall", MechanismOfInjury.FALL],
  ["mechanism_grenade", MechanismOfInjury.GRENADE],
  ["mechanism_gsw", MechanismOfInjury.GSW],
  ["mechanism_ied", MechanismOfInjury.IED],
  ["mechanism_landmine", MechanismOfInjury.LANDMINE],
  ["mechanism_mvc", MechanismOfInjury.MVC],
  ["mechanism_rpg", MechanismOfInjury.RPG],
  ["mechanism_other", MechanismOfInjury.OTHER],
];

const AIRWAY: ReadonlyArray<readonly [string, AirwayTreatment]> = [
  ["treatment_A_Intact", AirwayTreatment.INTACT],
  ["treatment_A_NPA", AirwayTreatment.NPA],
  ["treatment_A_CRIC", AirwayTreatment.CRIC],
  ["treatment_A_ET-Tube", AirwayTreatment.ET_TUBE],
  ["treatment_A_SGA", AirwayTreatment.SGA],
];

const BREATHING: ReadonlyArray<readonly [string, BreathingTreatment]> = [
  ["treatment_B_O2", BreathingTreatment.O2],
  ["treatment_B_NeedleD", BreathingTreatment.NEEDLE_D],
  ["treatment_B_Chest-Tube", BreathingTreatment.CHEST_TUBE],
  ["treatment_B_ChestSeal", BreathingTreatment.CHEST_SEAL],
];

const TQ_BOXES = ["treatment_C_TQ_Extremity", "treatment_C_TQ_Junctional", "treatment_C_TQ_Truncal"] as const;

const LIMBS: ReadonlyArray<readonly [Limb, string]> = [
  [Limb.RIGHT_ARM, "r_arm"],
  [Limb.LEFT_ARM, "l_arm"],
  [Limb.RIGHT_LEG, "r_leg"],
  [Limb.LEFT_LEG, "l_leg"],
];

const ROUTE_TO_PDF: Partial<Record<Route, string>> = {
  IM: "IM",
  IV: "IV",
  IO: "IO",
  IN: "IN",
  PO: "PO",
  PR: "PR",
  SC: "SQ",
};

const PDF_TO_ROUTE: Record<string, Route> = {
  IM: Route.IM,
  IV: Route.IV,
  IO: Route.IO,
  IN: Route.IN,
  PO: Route.PO,
  PR: Route.PR,
  SL: Route.OTHER,
  SQ: Route.SC,
};

export function routeToPaper(route: Route | null): string {
  if (!route) return "";
  return ROUTE_TO_PDF[route] ?? "";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatCardDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(2)}`;
}

export function formatCardTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}${pad(date.getMinutes())}`;
}

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

function parseDdMmmYy(value: string): Date | null {
  const match = value.trim().toUpperCase().match(/^(\d{1,2})[- ]([A-Z]{3})[- ](\d{2}|\d{4})$/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2] as (typeof MONTHS)[number]);
  if (month < 0) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(year, month, Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseHmm(value: string): { hours: number; minutes: number } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/) ?? trimmed.match(/^(\d{2})(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function str(value: Dd1380Values[string] | undefined): string {
  return typeof value === "string" ? value : "";
}

function on(values: Dd1380Values, name: string): boolean {
  return values[name] === true;
}

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

function active<T extends { deletedAt: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.deletedAt == null);
}

/** What the sheet shows: a stored card, or the board store's snapshot of one. */
export type SheetSource = Pick<
  LocalCasualtyCard,
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

export function parseAvpu(value: string): Avpu | null {
  const key = value.trim().charAt(0).toUpperCase();
  if (key === "A") return Avpu.ALERT;
  if (key === "V") return Avpu.VERBAL;
  if (key === "P") return Avpu.PAIN;
  if (key === "U") return Avpu.UNRESPONSIVE;
  return null;
}

export function parseRoute(value: string): Route | null {
  return PDF_TO_ROUTE[value.trim().toUpperCase()] ?? null;
}

const ALL_SITES = [...ANTERIOR_SITES, ...POSTERIOR_SITES];
const PAPER_SITE_IDS = new Set(ALL_SITES.map((site) => site.id));

export function isPaperSite(id: string | null | undefined): boolean {
  return id != null && PAPER_SITE_IDS.has(id);
}

export function markedSites(values: Dd1380Values): Array<{
  id: string;
  region: BodyRegion;
  view: (typeof BodyView)[keyof typeof BodyView];
  x: number;
  y: number;
}> {
  return ALL_SITES.filter((site) => on(values, site.id)).map((site) => ({
    id: site.id,
    region: regionFor(site.id),
    view: POSTERIOR_SITES.some((item) => item.id === site.id) ? BodyView.BACK : BodyView.FRONT,
    x: site.x,
    y: site.y,
  }));
}

export function regionFor(id: string): BodyRegion {
  if (/Head|Nose|Mouth|Chin|Eye|Ear|Cheek/.test(id)) {
    if (/Eye|Ear|Nose|Mouth|Chin|Cheek/.test(id)) return BodyRegion.FACE;
    return BodyRegion.HEAD;
  }
  if (/Neck/.test(id)) return BodyRegion.NECK;
  if (/Right_.*(?:Arm|Bicep|Elbow|Forearm|Wrist|Palm|Hand|Thumb|Fingers|Shoulder)/.test(id) || /Ant_Right_Shoulder|Post_Right_Shoulder|Right_Palm|Right_Hand/.test(id)) {
    return BodyRegion.RIGHT_ARM;
  }
  if (/Left_.*(?:Arm|Bicep|Elbow|Forearm|Wrist|Palm|Hand|Thumb|Fingers|Shoulder)/.test(id) || /Ant_Left_Shoulder|Post_Left_Shoulder|Left_Palm|Left_Hand/.test(id)) {
    return BodyRegion.LEFT_ARM;
  }
  if (/Right_.*(?:Thigh|Leg|Knee|Ankle|Foot|Heel|Toe)/.test(id) || /Right_Heel/.test(id)) return BodyRegion.RIGHT_LEG;
  if (/Left_.*(?:Thigh|Leg|Knee|Ankle|Foot|Heel|Toe)/.test(id) || /Left_Heel/.test(id)) return BodyRegion.LEFT_LEG;
  if (/Chest|Sternum|Axillary/.test(id)) return BodyRegion.CHEST;
  if (/UQ|LQ|Flank/.test(id)) return BodyRegion.ABDOMEN;
  if (/Pelvis|Groin|Hip|Genitals|Buttock|Tail/.test(id)) return BodyRegion.PELVIS;
  if (/Upper_Back/.test(id)) return BodyRegion.UPPER_BACK;
  if (/Middle_Back|Lower_Back|Spine/.test(id) || /Back/.test(id)) return BodyRegion.LOWER_BACK;
  return BodyRegion.CHEST;
}

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

export { str, on };
