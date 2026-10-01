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
    mechanisms: [],
    mechanismOther: null,
    circulation: [],
    airway: [],
    breathing: [],
    otherTreatments: [],
    notes: null,
    responderName: null,
    responderLast4: null,
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
  description: optionalText(200), // B-06
});
export type InjurySite = z.infer<typeof injurySiteSchema>;

export const tourniquetSchema = z.object({
  ...childRowBaseShape,
  limb: z.enum(Limb), // B-07
  type: text(50), // B-08
  appliedAt: isoDateTimeSchema, // B-09
});
export type Tourniquet = z.infer<typeof tourniquetSchema>;

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

export const vitalSignsSchema = z
  .object({
    ...childRowBaseShape,
    measuredAt: isoDateTimeSchema, // C-01
    pulseRate: intRange(0, 300), // C-02
    pulseLocation: optionalText(30), // C-03
    systolic: intRange(0, 300), // C-04
    diastolic: intRange(0, 200), // C-05
    respiratoryRate: intRange(0, 80), // C-06
    spo2: intRange(0, 100), // C-07
    avpu: z.enum(Avpu).nullable(), // C-08
    painScale: intRange(0, 10), // C-09
  })
  .refine((v) => VITAL_MEASUREMENTS.some((key) => v[key] != null), {
    message: "At least one measurement is required",
  })
  .refine((v) => v.systolic == null || v.diastolic == null || v.systolic >= v.diastolic, {
    message: "Systolic pressure must not be lower than diastolic",
    path: ["systolic"],
  });
export type VitalSigns = z.infer<typeof vitalSignsSchema>;

export const fluidSchema = z.object({
  ...childRowBaseShape,
  kind: z.enum(FluidKind), // E-04
  name: text(100), // E-05
  volumeMl: z.number().int().min(1).max(10000), // E-06
  route: z.enum(Route), // E-07
  administeredAt: isoDateTimeSchema, // E-08
});
export type Fluid = z.infer<typeof fluidSchema>;

export const medicationSchema = z.object({
  ...childRowBaseShape,
  category: z.enum(MedicationCategory), // F-01
  name: text(100), // F-02
  dose: text(50), // F-03
  route: z.enum(Route), // F-04
  administeredAt: isoDateTimeSchema, // F-05
});
export type Medication = z.infer<typeof medicationSchema>;

// Sections C and F are repeating groups on the card, so their section schemas
// describe one row (one vitals set, one medication) rather than card fields.
export const sectionCSchema = vitalSignsSchema;
export const sectionFSchema = medicationSchema;

export const CHILD_ENTITIES = ["injurySite", "tourniquet", "vitalSigns", "fluid", "medication"] as const;
export type ChildEntity = (typeof CHILD_ENTITIES)[number];

export interface ChildRowByEntity {
  injurySite: InjurySite;
  tourniquet: Tourniquet;
  vitalSigns: VitalSigns;
  fluid: Fluid;
  medication: Medication;
}

export const childSchemas = {
  injurySite: injurySiteSchema,
  tourniquet: tourniquetSchema,
  vitalSigns: vitalSignsSchema,
  fluid: fluidSchema,
  medication: medicationSchema,
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
