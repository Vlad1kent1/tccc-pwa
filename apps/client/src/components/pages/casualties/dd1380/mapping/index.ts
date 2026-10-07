import {
  AirwayTreatment,
  Avpu,
  BodyRegion,
  BodyView,
  BreathingTreatment,
  CirculationTreatment,
  EvacPriority,
  FluidKind,
  Gender,
  Limb,
  MechanismOfInjury,
  MedicationCategory,
  OtherTreatment,
  Route,
} from "@tccc/shared";
import type { LocalCasualtyCard } from "@/lib/db";
import type { Dd1380Values } from "@/components/pages/casualties/dd1380/form-context";
import { ANTERIOR_SITES, POSTERIOR_SITES } from "@/components/pages/casualties/dd1380/injury-sites";

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

const AVPU_LABEL: Record<Avpu, string> = {
  ALERT: "A - Alert",
  VERBAL: "V - Verbal",
  PAIN: "P - Pain",
  UNRESPONSIVE: "U - Unresponsive",
};

const PAIN_LABEL = [
  "0 None",
  "1 Very Mild",
  "2 Discomfort",
  "3 Tolerable",
  "4 Distressing",
  "5 Very Distress",
  "6 Intense",
  "7 Very Intense",
  "8 Horrible",
  "9 Excruciating",
  "10 Unimaginable",
] as const;

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

export function parseCardStamp(dateText: string, timeText: string, fallbackIso?: string | null): string | null {
  const date = parseDdMmmYy(dateText) ?? (fallbackIso ? startOfLocalDay(fallbackIso) : startOfLocalDay(new Date().toISOString()));
  const time = parseHmm(timeText);
  if (!date && time == null) return null;
  const base = date ?? new Date();
  if (time) {
    base.setHours(time.hours, time.minutes, 0, 0);
  }
  return base.toISOString();
}

function startOfLocalDay(iso: string): Date {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  return date;
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

function nameLine(last: string | null, first: string | null): string {
  return [last, first].filter(Boolean).join(", ");
}

function splitName(value: string): { lastName: string | null; firstName: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { lastName: null, firstName: null };
  const comma = trimmed.indexOf(",");
  if (comma >= 0) {
    const lastName = trimmed.slice(0, comma).trim() || null;
    const firstName = trimmed.slice(comma + 1).trim() || null;
    return { lastName, firstName };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { lastName: parts[0], firstName: null };
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function active<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt == null);
}

export function cardToValues(card: LocalCasualtyCard): Dd1380Values {
  const values: Record<string, string | boolean> = {};
  values.name = nameLine(card.lastName, card.firstName);
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

  if (card.circulation.includes(CirculationTreatment.TOURNIQUET)) values.treatment_C_TQ_Extremity = true;
  if (card.circulation.includes(CirculationTreatment.HEMOSTATIC)) values.treatment_C_Dressing_Hemostatic = true;
  if (card.circulation.includes(CirculationTreatment.PRESSURE)) values.treatment_C_Dressing_Pressure = true;
  if (card.circulation.includes(CirculationTreatment.DRESSING)) values.treatment_C_Dressing_Other = true;
  for (const [name, item] of AIRWAY) {
    if (card.airway.includes(item)) values[name] = true;
  }
  for (const [name, item] of BREATHING) {
    if (card.breathing.includes(item)) values[name] = true;
  }
  if (card.otherTreatments.includes(OtherTreatment.EYE_SHIELD)) values.treatment_other_EyeShield = true;
  if (card.otherTreatments.includes(OtherTreatment.SPLINT)) values.treatment_other_Splint = true;
  if (card.otherTreatments.includes(OtherTreatment.HYPOTHERMIA_PREVENTION)) {
    values.treatment_other_HypothermiaPrevention = true;
  }

  for (const [limb, prefix] of LIMBS) {
    const row = active(card.tourniquets).find((item) => item.limb === limb);
    if (row) {
      values[`${prefix}_type`] = row.type;
      values[`${prefix}_time`] = formatCardTime(row.appliedAt);
    }
  }

  for (const site of active(card.injurySites)) {
    if (site.description) values[site.description] = true;
  }

  const vitals = [...active(card.vitalSigns)].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt) || a.id.localeCompare(b.id)).slice(0, 4);
  vitals.forEach((row, i) => {
    const n = i + 1;
    values[vitalSlotKey(n)] = row.id;
    values[`time${n}`] = formatCardTime(row.measuredAt);
    values[`pulse${n}`] = [row.pulseRate, row.pulseLocation].filter((part) => part != null && part !== "").join(" ");
    if (row.systolic != null) values[`bloodPressureA${n}`] = String(row.systolic);
    if (row.diastolic != null) values[`bloodPressureB${n}`] = String(row.diastolic);
    if (row.respiratoryRate != null) values[`respRate${n}`] = String(row.respiratoryRate);
    if (row.spo2 != null) values[`o2sat${n}`] = String(row.spo2);
    if (row.avpu) values[`avpu${n}`] = AVPU_LABEL[row.avpu];
    if (row.painScale != null) values[`pain${n}`] = PAIN_LABEL[row.painScale] ?? String(row.painScale);
  });

  fillKind(values, active(card.fluids).filter((row) => row.kind === FluidKind.FLUID), "treatment_C_Fluid", 2);
  fillKind(values, active(card.fluids).filter((row) => row.kind === FluidKind.BLOOD_PRODUCT), "treatment_C_BloodProduct", 2);
  fillMeds(values, active(card.medications).filter((row) => row.category === MedicationCategory.ANALGESIC), "treatment_MEDS_Analgesic", 3);
  fillMeds(values, active(card.medications).filter((row) => row.category === MedicationCategory.ANTIBIOTIC), "treatment_MEDS_Antibiotic", 2);
  fillMeds(values, active(card.medications).filter((row) => row.category === MedicationCategory.OTHER), "treatment_MEDS_Other", 2);

  return values;
}

function fillKind(
  values: Record<string, string | boolean>,
  rows: LocalCasualtyCard["fluids"],
  prefix: string,
  slots: number,
) {
  rows.slice(0, slots).forEach((row, i) => {
    const n = i + 1;
    values[slotKey(prefix, n)] = row.id;
    values[`${prefix}_Name${n}`] = row.name;
    values[`${prefix}_Volume${n}`] = String(row.volumeMl);
    values[`${prefix}_Route${n}`] = ROUTE_TO_PDF[row.route] ?? "";
    values[`${prefix}_Time${n}`] = formatCardTime(row.administeredAt);
  });
}

function fillMeds(
  values: Record<string, string | boolean>,
  rows: LocalCasualtyCard["medications"],
  prefix: string,
  slots: number,
) {
  rows.slice(0, slots).forEach((row, i) => {
    const n = i + 1;
    values[slotKey(prefix, n)] = row.id;
    values[`${prefix}_Name${n}`] = row.name;
    values[`${prefix}_Dose${n}`] = row.dose;
    values[`${prefix}_Route${n}`] = ROUTE_TO_PDF[row.route] ?? "";
    values[`${prefix}_Time${n}`] = formatCardTime(row.administeredAt);
  });
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

  const last4 = str(values.firstResponder_last4).replace(/\D/g, "").slice(0, 4);

  return {
    lastName,
    firstName,
    gender,
    injuredAt: parseCardStamp(str(values.date), str(values.time)),
    battleRosterNumber: str(values.roster).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 20) || null,
    evacPriority,
    allergies: str(values.allergies).trim() || null,
    mechanisms,
    mechanismOther: str(values.mechanism_specify).trim() || null,
    circulation,
    airway,
    breathing,
    otherTreatments,
    notes: str(values.notes).trim() || null,
    responderName: str(values.firstResponder_name).trim() || null,
    responderLast4: last4.length === 4 ? last4 : null,
  };
}

export function pulseParts(value: string): { pulseRate: number | null; pulseLocation: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { pulseRate: null, pulseLocation: null };
  const match = trimmed.match(/^(\d+)\s*(.*)$/);
  if (!match) return { pulseRate: null, pulseLocation: trimmed };
  return { pulseRate: Number(match[1]), pulseLocation: match[2].trim() || null };
}

export function parseAvpu(value: string): Avpu | null {
  const key = value.trim().charAt(0).toUpperCase();
  if (key === "A") return Avpu.ALERT;
  if (key === "V") return Avpu.VERBAL;
  if (key === "P") return Avpu.PAIN;
  if (key === "U") return Avpu.UNRESPONSIVE;
  return null;
}

export function parsePain(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 0 && n <= 10 ? n : null;
}

export function parseVolume(value: string): number | null {
  const match = value.trim().match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 10000 ? n : null;
}

export function parseRoute(value: string): Route | null {
  return PDF_TO_ROUTE[value.trim().toUpperCase()] ?? null;
}

export function intField(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

const ALL_SITES = [...ANTERIOR_SITES, ...POSTERIOR_SITES];

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
