import type {
  AirwayTreatment,
  BreathingTreatment,
  CirculationTreatment,
  EvacPriority,
  Fluid,
  Gender,
  InjurySite,
  MechanismOfInjury,
  Medication,
  OtherTreatment,
  RowDrafts,
  Tourniquet,
  VitalSigns,
} from "@tccc/shared";
import type { LocalCasualtyCard } from "@/lib/db";
import { EMPTY_LAYOUT, layoutPaper, type PaperLayout } from "@/components/pages/casualties/board/paper-layout";
import { tourniquetPlacement } from "@/components/pages/casualties/board/treatment-flags";

export type BoardSlice =
  | "identity"
  | "mechanism"
  | "body"
  | "treatments"
  | "vitals"
  | "fluids"
  | "meds"
  | "notes"
  | "responder"
  | "drafts";

/**
 * A row as the board holds it. Its card is the board's own, so the row has no
 * `cardId`; the repository adds it when the row is saved.
 */
type BoardRow<T> = Omit<T, "cardId">;

export type InjuryRow = BoardRow<InjurySite>;
export type TourniquetRow = BoardRow<Tourniquet>;
export type VitalRow = BoardRow<VitalSigns>;
export type FluidRow = BoardRow<Fluid>;
export type MedicationRow = BoardRow<Medication>;

export interface BoardTreatments {
  circulation: CirculationTreatment[];
  airway: AirwayTreatment[];
  breathing: BreathingTreatment[];
  otherTreatments: OtherTreatment[];
  tqExtremity: boolean;
  tqJunctional: boolean;
  tqTruncal: boolean;
  dressingOtherType: string | null;
  circulationTqType: string | null;
  circulationDressingType: string | null;
  airwayType: string | null;
  breathingType: string | null;
  combatPillPack: boolean;
  eyeShieldRight: boolean;
  eyeShieldLeft: boolean;
  hypothermiaType: string | null;
}

/** Treatment fields that hold a list of checked items. */
export type TreatmentListKey = "circulation" | "airway" | "breathing" | "otherTreatments";

export interface BoardSnapshot {
  cardId: string | null;
  remote: boolean;
  identity: {
    lastName: string | null;
    firstName: string | null;
    gender: Gender | null;
    evacPriority: EvacPriority | null;
    allergies: string | null;
    battleRosterNumber: string | null;
    injuredAt: string | null;
    casualtyLast4: string | null;
    service: string | null;
    unit: string | null;
  };
  mechanism: {
    mechanisms: MechanismOfInjury[];
    mechanismOther: string | null;
  };
  injuries: InjuryRow[];
  tourniquets: TourniquetRow[];
  treatments: BoardTreatments;
  vitals: VitalRow[];
  fluids: FluidRow[];
  medications: MedicationRow[];
  notes: string | null;
  responder: {
    responderName: string | null;
    responderLast4: string | null;
  };
  rowDrafts: RowDrafts;
  /** Which row each column of the printed vitals, fluid, and medication tables shows. Not saved. */
  paper: PaperLayout;
  /**
   * DD1380 sheet text exactly as typed, by sheet field name ("Van " or a date still
   * missing its time). Not saved: the values it stands for are in the slices above.
   */
  sheetText: Readonly<Record<string, string>>;
}

export function emptySnapshot(cardId: string | null): BoardSnapshot {
  return {
    cardId,
    remote: false,
    identity: {
      lastName: null,
      firstName: null,
      gender: null,
      evacPriority: null,
      allergies: null,
      battleRosterNumber: null,
      injuredAt: null,
      casualtyLast4: null,
      service: null,
      unit: null,
    },
    mechanism: { mechanisms: [], mechanismOther: null },
    injuries: [],
    tourniquets: [],
    treatments: {
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
    },
    vitals: [],
    fluids: [],
    medications: [],
    notes: null,
    responder: { responderName: null, responderLast4: null },
    rowDrafts: {},
    paper: EMPTY_LAYOUT,
    sheetText: {},
  };
}

export const EMPTY_SNAPSHOT = emptySnapshot(null);

export function snapshotFromCard(card: LocalCasualtyCard): BoardSnapshot {
  const vitals = card.vitalSigns.filter((row) => row.deletedAt == null);
  const fluids = card.fluids.filter((row) => row.deletedAt == null);
  const medications = card.medications.filter((row) => row.deletedAt == null);
  return {
    cardId: card.id,
    remote: false,
    identity: {
      lastName: card.lastName,
      firstName: card.firstName,
      gender: card.gender,
      evacPriority: card.evacPriority,
      allergies: card.allergies,
      battleRosterNumber: card.battleRosterNumber,
      injuredAt: card.injuredAt,
      casualtyLast4: card.casualtyLast4,
      service: card.service,
      unit: card.unit,
    },
    mechanism: { mechanisms: card.mechanisms, mechanismOther: card.mechanismOther },
    injuries: card.injurySites.filter((row) => row.deletedAt == null),
    tourniquets: card.tourniquets.filter((row) => row.deletedAt == null),
    treatments: {
      circulation: card.circulation,
      airway: card.airway,
      breathing: card.breathing,
      otherTreatments: card.otherTreatments,
      ...tourniquetPlacement(card),
      dressingOtherType: card.dressingOtherType,
      circulationTqType: card.circulationTqType,
      circulationDressingType: card.circulationDressingType,
      airwayType: card.airwayType,
      breathingType: card.breathingType,
      combatPillPack: card.combatPillPack,
      eyeShieldRight: card.eyeShieldRight,
      eyeShieldLeft: card.eyeShieldLeft,
      hypothermiaType: card.hypothermiaType,
    },
    vitals,
    fluids,
    medications,
    notes: card.notes,
    responder: { responderName: card.responderName, responderLast4: card.responderLast4 },
    rowDrafts: card.rowDrafts,
    paper: layoutPaper({ vitals, fluids, medications }),
    sheetText: {},
  };
}
