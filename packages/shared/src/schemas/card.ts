import { z } from "zod";
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
} from "../enums.js";
import { HLC_PATTERN } from "../hlc.js";

// Field IDs in comments (A-01, C-09, ...) refer to docs/requirements.md, Section 5.

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const hlcSchema = z.string().regex(HLC_PATTERN, "Invalid HLC timestamp");

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable();
const intRange = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

function uniqueEnumArray<T extends Record<string, string>>(values: T) {
  return z
    .array(z.enum(values))
    .refine((items) => new Set(items).size === items.length, "Duplicate values are not allowed");
}

// ---------- Card scalar fields, by DD1380 section ----------

export const sectionAShape = {
  lastName: optionalText(100), // A-01
  firstName: optionalText(100), // A-02
  gender: z.enum(Gender).nullable(), // A-03
  injuredAt: isoDateTimeSchema.nullable(), // A-04 + A-05
  battleRosterNumber: z
    .string()
    .regex(/^[\p{L}\p{N}]{1,20}$/u, "1-20 letters or digits")
    .nullable(), // A-06
  evacPriority: z.enum(EvacPriority).nullable(), // A-07
  allergies: optionalText(500), // A-08
  casualtyLast4: z.string().regex(/^\d{4}$/, "Exactly four digits").nullable(), // casualty "Last 4"
  service: optionalText(100),
  unit: optionalText(100),
};

export const sectionBShape = {
  mechanisms: uniqueEnumArray(MechanismOfInjury), // B-01
  mechanismOther: optionalText(200), // B-02
};

export const sectionEShape = {
  circulation: uniqueEnumArray(CirculationTreatment), // E-01
  airway: uniqueEnumArray(AirwayTreatment), // E-02
  breathing: uniqueEnumArray(BreathingTreatment), // E-03
  otherTreatments: uniqueEnumArray(OtherTreatment), // E-09
  // Paper-card details the enum arrays collapse. Each checkbox is its own field so
  // it has its own clock in the field-level merge.
  tqExtremity: z.boolean(), // C: TQ - Extremity
  tqJunctional: z.boolean(), // C: TQ - Junctional
  tqTruncal: z.boolean(), // C: TQ - Truncal
  dressingOtherType: optionalText(100), // C: Dressing - Other, specify
  circulationTqType: optionalText(100), // "Type" column, C: TQ row
  circulationDressingType: optionalText(100), // "Type" column, C: Dressing row
  airwayType: optionalText(100), // "Type" column, A row
  breathingType: optionalText(100), // "Type" column, B row
  combatPillPack: z.boolean(), // Other: Combat Pill Pack
  eyeShieldRight: z.boolean(), // Other: Eye Shield (R)
  eyeShieldLeft: z.boolean(), // Other: Eye Shield (L)
  hypothermiaType: optionalText(100), // Other: Hypothermia Prevention, type
};

/**
 * Text typed into a vitals, fluid, or medication cell that is not yet a valid stored
 * value (e.g. a half-typed time), keyed by row id and then by column.
 */
export const rowDraftsSchema = z.record(z.string(), z.record(z.string(), z.string().max(200)));
export type RowDrafts = z.infer<typeof rowDraftsSchema>;

export const rowDraftsShape = {
  rowDrafts: rowDraftsSchema,
};

export const sectionGShape = {
  notes: optionalText(4000), // G-01
};

export const sectionHShape = {
  responderName: optionalText(100), // H-01
  responderLast4: z.string().regex(/^\d{4}$/, "Exactly four digits").nullable(), // H-02
};

export const sectionASchema = z.object(sectionAShape);
export const sectionBSchema = z.object(sectionBShape);
export const sectionESchema = z.object(sectionEShape);
export const sectionGSchema = z.object(sectionGShape);
export const sectionHSchema = z.object(sectionHShape);

const cardFieldsShape = {
  ...sectionAShape,
  ...sectionBShape,
  ...sectionEShape,
  ...sectionGShape,
  ...sectionHShape,
  ...rowDraftsShape,
};

export const cardFieldsSchema = z.object(cardFieldsShape);
export type CardFields = z.infer<typeof cardFieldsSchema>;
export type CardField = keyof CardFields;

export const CARD_FIELDS = Object.keys(cardFieldsShape) as [CardField, ...CardField[]];

/** A partial update of card scalar fields; unknown keys are rejected. */
export const cardPatchSchema = cardFieldsSchema.partial().strict();
export type CardPatch = z.infer<typeof cardPatchSchema>;

export function emptyCardFields(): CardFields {
  return {
    lastName: null,
    firstName: null,
    gender: null,
    injuredAt: null,
    battleRosterNumber: null,
    evacPriority: null,
    allergies: null,
    casualtyLast4: null,
    service: null,
    unit: null,
    mechanisms: [],
    mechanismOther: null,
    circulation: [],
    airway: [],
    breathing: [],
    otherTreatments: [],
    tqExtremity: false,
    tqJunctional: false,
    tqTruncal: false,
    dressingOtherType: null,
    circulationTqType: null,
    circulationDressingType: null,
    airwayType: null,
    breathingType: null,
    combatPillPack: false,
    eyeShieldRight: false,
    eyeShieldLeft: false,
    hypothermiaType: null,
    notes: null,
    responderName: null,
    responderLast4: null,
    rowDrafts: {},
  };
}

// ---------- Child rows ----------

const childRowBaseShape = {
  id: uuidSchema,
  cardId: uuidSchema,
  clientUpdatedAt: hlcSchema,
  deletedAt: isoDateTimeSchema.nullable(),
};

export const injurySiteSchema = z.object({
  ...childRowBaseShape,
  region: z.enum(BodyRegion), // B-03
  view: z.enum(BodyView), // B-04
  x: z.number().min(0).max(1).nullable(), // B-05
  y: z.number().min(0).max(1).nullable(),
  /**
   * The printed DD1380 target this row marks (e.g. `Ant_Right_Shoulder`), or null
   * for an X placed freely on the figure, which the row id identifies.
   */
  siteCode: z.string().trim().min(1).max(64).nullable().default(null),
  description: optionalText(200), // B-06, free text only
});
export type InjurySite = z.infer<typeof injurySiteSchema>;

export const tourniquetSchema = z.object({
  ...childRowBaseShape,
  limb: z.enum(Limb), // B-07
  type: text(50), // B-08
  appliedAt: isoDateTimeSchema, // B-09
});
export type Tourniquet = z.infer<typeof tourniquetSchema>;

// Vitals, fluid, and medication rows, like the paper card, may be partly filled in:
// a medic writes the drug before the dose, or the time before the readings. These
// row schemas are what the device stores, the outbox sends, and the server keeps, so
// an unfinished row syncs like any other. The `complete*` schemas below require every
// column a finished entry has; the REST API creates rows with them.

const VITAL_MEASUREMENTS = [
  "pulseRate",
  "pulseLocation",
  "systolic",
  "diastolic",
  "respiratoryRate",
  "spo2",
  "avpu",
  "painScale",
] as const;

const vitalReadingsShape = {
  measuredAt: isoDateTimeSchema, // C-01
  pulseRate: intRange(0, 300), // C-02
  pulseLocation: z.string().trim().max(30).nullable(), // C-03
  systolic: intRange(0, 300), // C-04
  diastolic: intRange(0, 200), // C-05
  respiratoryRate: intRange(0, 80), // C-06
  spo2: intRange(0, 100), // C-07
  avpu: z.enum(Avpu).nullable(), // C-08
  painScale: intRange(0, 10), // C-09
};

const bloodPressureRule = {
  check: (v: { systolic: number | null; diastolic: number | null }) =>
    v.systolic == null || v.diastolic == null || v.systolic >= v.diastolic,
  message: { message: "Systolic pressure must not be lower than diastolic", path: ["systolic"] },
};

export const vitalSignsSchema = z
  .object({ ...childRowBaseShape, ...vitalReadingsShape })
  .refine(bloodPressureRule.check, bloodPressureRule.message);
export type VitalSigns = z.infer<typeof vitalSignsSchema>;

export const completeVitalSignsSchema = z
  .object({ ...childRowBaseShape, ...vitalReadingsShape, pulseLocation: optionalText(30) })
  .refine((v) => VITAL_MEASUREMENTS.some((key) => v[key] != null), {
    message: "At least one measurement is required",
  })
  .refine(bloodPressureRule.check, bloodPressureRule.message);

export const fluidSchema = z
  .object({
    ...childRowBaseShape,
    kind: z.enum(FluidKind), // E-04
    name: z.string().trim().max(100), // E-05
    volumeMl: z.number().int().min(1).max(10000).nullable(), // E-06
    route: z.enum(Route).nullable(), // E-07
    administeredAt: isoDateTimeSchema.nullable(), // E-08
  })
  .refine((row) => row.name !== "" || row.volumeMl != null || row.route != null || row.administeredAt != null, {
    message: "Fluid row is empty",
  });
export type Fluid = z.infer<typeof fluidSchema>;

export const completeFluidSchema = z.object({
  ...childRowBaseShape,
  kind: z.enum(FluidKind),
  name: text(100),
  volumeMl: z.number().int().min(1).max(10000),
  route: z.enum(Route),
  administeredAt: isoDateTimeSchema,
});

export const medicationSchema = z
  .object({
    ...childRowBaseShape,
    category: z.enum(MedicationCategory), // F-01
    name: z.string().trim().max(100), // F-02
    dose: z.string().trim().max(50), // F-03
    route: z.enum(Route).nullable(), // F-04
    administeredAt: isoDateTimeSchema.nullable(), // F-05
  })
  .refine((row) => row.name !== "" || row.dose !== "" || row.route != null || row.administeredAt != null, {
    message: "Medication row is empty",
  });
export type Medication = z.infer<typeof medicationSchema>;

export const completeMedicationSchema = z.object({
  ...childRowBaseShape,
  category: z.enum(MedicationCategory),
  name: text(100),
  dose: text(50),
  route: z.enum(Route),
  administeredAt: isoDateTimeSchema,
});

// Sections C and F are repeating groups on the card, so their section schemas
// describe one row (one vitals set, one medication) rather than card fields.
export const sectionCSchema = completeVitalSignsSchema;
export const sectionFSchema = completeMedicationSchema;

export const CHILD_ENTITIES = ["injurySite", "tourniquet", "vitalSigns", "fluid", "medication"] as const;
export type ChildEntity = (typeof CHILD_ENTITIES)[number];

export interface ChildRowByEntity {
  injurySite: InjurySite;
  tourniquet: Tourniquet;
  vitalSigns: VitalSigns;
  fluid: Fluid;
  medication: Medication;
}

/** Rows as stored and synced; unfinished vitals, fluid, and medication rows included. */
export const childSchemas = {
  injurySite: injurySiteSchema,
  tourniquet: tourniquetSchema,
  vitalSigns: vitalSignsSchema,
  fluid: fluidSchema,
  medication: medicationSchema,
} as const;

/** Rows with every column a finished entry needs. */
export const completeChildSchemas = {
  injurySite: injurySiteSchema,
  tourniquet: tourniquetSchema,
  vitalSigns: completeVitalSignsSchema,
  fluid: completeFluidSchema,
  medication: completeMedicationSchema,
} as const;

/** Name of the card property that holds each child collection. */
export const CHILD_COLLECTIONS = {
  injurySite: "injurySites",
  tourniquet: "tourniquets",
  vitalSigns: "vitalSigns",
  fluid: "fluids",
  medication: "medications",
} as const satisfies Record<ChildEntity, string>;

export type ChildCollections = {
  injurySites: InjurySite[];
  tourniquets: Tourniquet[];
  vitalSigns: VitalSigns[];
  fluids: Fluid[];
  medications: Medication[];
};

// ---------- Card aggregate (server representation) ----------

export const casualtyCardSchema = z.object({
  id: uuidSchema,
  ...cardFieldsShape,
  injurySites: z.array(injurySiteSchema),
  tourniquets: z
    .array(tourniquetSchema)
    .refine(
      (rows) => new Set(rows.map((row) => row.limb)).size === rows.length,
      "At most one tourniquet per limb",
    ),
  vitalSigns: z.array(vitalSignsSchema),
  fluids: z.array(fluidSchema),
  medications: z.array(medicationSchema),
  fieldClock: z.record(z.string(), hlcSchema),
  version: z.number().int().min(1),
  changeSeq: z.string().regex(/^\d+$/), // BigInt serialized as a decimal string
  createdByDeviceId: uuidSchema,
  createdAt: isoDateTimeSchema,
  serverUpdatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});
export type CasualtyCard = z.infer<typeof casualtyCardSchema>;
