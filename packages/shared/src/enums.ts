// Mirrors the enums in apps/server/prisma/schema.prisma (DD Form 1380 checkboxes).
// apps/server/src/prisma/shared-enums.spec.ts fails if the two drift apart.

export const Gender = {
  MALE: "MALE",
  FEMALE: "FEMALE",
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export const EvacPriority = {
  URGENT: "URGENT",
  PRIORITY: "PRIORITY",
  ROUTINE: "ROUTINE",
} as const;
export type EvacPriority = (typeof EvacPriority)[keyof typeof EvacPriority];

export const MechanismOfInjury = {
  ARTILLERY: "ARTILLERY",
  BLUNT: "BLUNT",
  BURN: "BURN",
  FALL: "FALL",
  GRENADE: "GRENADE",
  GSW: "GSW",
  IED: "IED",
  LANDMINE: "LANDMINE",
  MVC: "MVC",
  RPG: "RPG",
  OTHER: "OTHER",
} as const;
export type MechanismOfInjury = (typeof MechanismOfInjury)[keyof typeof MechanismOfInjury];

export const Limb = {
  RIGHT_ARM: "RIGHT_ARM",
  LEFT_ARM: "LEFT_ARM",
  RIGHT_LEG: "RIGHT_LEG",
  LEFT_LEG: "LEFT_LEG",
} as const;
export type Limb = (typeof Limb)[keyof typeof Limb];

export const BodyRegion = {
  HEAD: "HEAD",
  FACE: "FACE",
  NECK: "NECK",
  CHEST: "CHEST",
  ABDOMEN: "ABDOMEN",
  PELVIS: "PELVIS",
  UPPER_BACK: "UPPER_BACK",
  LOWER_BACK: "LOWER_BACK",
  RIGHT_ARM: "RIGHT_ARM",
  LEFT_ARM: "LEFT_ARM",
  RIGHT_LEG: "RIGHT_LEG",
  LEFT_LEG: "LEFT_LEG",
} as const;
export type BodyRegion = (typeof BodyRegion)[keyof typeof BodyRegion];

export const BodyView = {
  FRONT: "FRONT",
  BACK: "BACK",
} as const;
export type BodyView = (typeof BodyView)[keyof typeof BodyView];

export const Avpu = {
  ALERT: "ALERT",
  VERBAL: "VERBAL",
  PAIN: "PAIN",
  UNRESPONSIVE: "UNRESPONSIVE",
} as const;
export type Avpu = (typeof Avpu)[keyof typeof Avpu];

export const CirculationTreatment = {
  TOURNIQUET: "TOURNIQUET",
  DRESSING: "DRESSING",
  HEMOSTATIC: "HEMOSTATIC",
  PRESSURE: "PRESSURE",
} as const;
export type CirculationTreatment = (typeof CirculationTreatment)[keyof typeof CirculationTreatment];

export const AirwayTreatment = {
  INTACT: "INTACT",
  NPA: "NPA",
  CRIC: "CRIC",
  ET_TUBE: "ET_TUBE",
  SGA: "SGA",
} as const;
export type AirwayTreatment = (typeof AirwayTreatment)[keyof typeof AirwayTreatment];

export const BreathingTreatment = {
  O2: "O2",
  NEEDLE_D: "NEEDLE_D",
  CHEST_TUBE: "CHEST_TUBE",
  CHEST_SEAL: "CHEST_SEAL",
} as const;
export type BreathingTreatment = (typeof BreathingTreatment)[keyof typeof BreathingTreatment];

export const OtherTreatment = {
  EYE_SHIELD: "EYE_SHIELD",
  SPLINT: "SPLINT",
  HYPOTHERMIA_PREVENTION: "HYPOTHERMIA_PREVENTION",
} as const;
export type OtherTreatment = (typeof OtherTreatment)[keyof typeof OtherTreatment];

export const FluidKind = {
  FLUID: "FLUID",
  BLOOD_PRODUCT: "BLOOD_PRODUCT",
} as const;
export type FluidKind = (typeof FluidKind)[keyof typeof FluidKind];

export const MedicationCategory = {
  ANALGESIC: "ANALGESIC",
  ANTIBIOTIC: "ANTIBIOTIC",
  OTHER: "OTHER",
} as const;
export type MedicationCategory = (typeof MedicationCategory)[keyof typeof MedicationCategory];

export const Route = {
  IV: "IV",
  IO: "IO",
  IM: "IM",
  IN: "IN",
  PO: "PO",
  SC: "SC",
  PR: "PR",
  TOPICAL: "TOPICAL",
  OTHER: "OTHER",
} as const;
export type Route = (typeof Route)[keyof typeof Route];

export const ENUMS = {
  Gender,
  EvacPriority,
  MechanismOfInjury,
  Limb,
  BodyRegion,
  BodyView,
  Avpu,
  CirculationTreatment,
  AirwayTreatment,
  BreathingTreatment,
  OtherTreatment,
  FluidKind,
  MedicationCategory,
  Route,
} as const;
