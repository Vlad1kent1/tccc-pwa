import type {
  AirwayTreatment,
  BreathingTreatment,
  CirculationTreatment,
  EvacPriority,
  Gender,
  MechanismOfInjury,
  OtherTreatment,
} from "@tccc/shared";
import type { LocalCasualtyCard } from "@/lib/db";

export type BoardSlice = "identity" | "mechanism" | "body" | "treatments" | "vitals" | "fluids" | "meds" | "notes" | "responder";

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
  };
  mechanism: {
    mechanisms: MechanismOfInjury[];
    mechanismOther: string | null;
  };
  injuries: LocalCasualtyCard["injurySites"];
  tourniquets: LocalCasualtyCard["tourniquets"];
  treatments: {
    circulation: CirculationTreatment[];
    airway: AirwayTreatment[];
    breathing: BreathingTreatment[];
    otherTreatments: OtherTreatment[];
  };
  vitals: LocalCasualtyCard["vitalSigns"];
  fluids: LocalCasualtyCard["fluids"];
  medications: LocalCasualtyCard["medications"];
  notes: string | null;
  responder: {
    responderName: string | null;
    responderLast4: string | null;
  };
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
    },
    mechanism: { mechanisms: [], mechanismOther: null },
    injuries: [],
    tourniquets: [],
    treatments: { circulation: [], airway: [], breathing: [], otherTreatments: [] },
    vitals: [],
    fluids: [],
    medications: [],
    notes: null,
    responder: { responderName: null, responderLast4: null },
  };
}

export const EMPTY_SNAPSHOT = emptySnapshot(null);

export function snapshotFromCard(card: LocalCasualtyCard): BoardSnapshot {
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
    },
    mechanism: { mechanisms: card.mechanisms, mechanismOther: card.mechanismOther },
    injuries: card.injurySites.filter((row) => row.deletedAt == null),
    tourniquets: card.tourniquets.filter((row) => row.deletedAt == null),
    treatments: {
      circulation: card.circulation,
      airway: card.airway,
      breathing: card.breathing,
      otherTreatments: card.otherTreatments,
    },
    vitals: card.vitalSigns.filter((row) => row.deletedAt == null),
    fluids: card.fluids.filter((row) => row.deletedAt == null),
    medications: card.medications.filter((row) => row.deletedAt == null),
    notes: card.notes,
    responder: { responderName: card.responderName, responderLast4: card.responderLast4 },
  };
}
