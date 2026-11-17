import { Limb, type BodyRegion } from "@tccc/shared";
import { normalizeText } from "@/lib/forms/card-patch";
import { DRAFT_KEY } from "../pending";
import { EMPTY_SNAPSHOT, type BoardSlice, type BoardSnapshot } from "../snapshot";

// Free functions of the board store, moved out of the class file unchanged (P2-023).

export function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** True when the shown value saves as `stored` once normalized like a save (`cleanCardPatch`). */
function savesAs(shown: unknown, stored: unknown): boolean {
  return sameJson(shown, stored) || sameJson(normalizeText(shown), stored);
}

/**
 * The stored value, except that shown text which saves as it is kept as typed. A section object
 * is merged field by field; when every field is kept, the shown object itself is returned.
 */
export function keepTyped<T>(shown: T, stored: T): T {
  if (!isRecord(shown) || !isRecord(stored)) return savesAs(shown, stored) ? shown : stored;
  let keptAll = true;
  const merged: Record<string, unknown> = { ...stored };
  for (const key of Object.keys(stored)) {
    if (savesAs(shown[key], stored[key])) merged[key] = shown[key];
    else keptAll = false;
  }
  return keptAll ? shown : (merged as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function upsertById<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((item) => item.id === row.id) ? rows.map((item) => (item.id === row.id ? row : item)) : [...rows, row];
}

/** The section of a card field, or of a `rowDrafts:<row id>` key. */
export function sliceOfField(field: string): BoardSlice {
  if (field === "rowDrafts" || field.startsWith(DRAFT_KEY)) return "drafts";
  if (field in EMPTY_SNAPSHOT.identity) return "identity";
  if (field in EMPTY_SNAPSHOT.mechanism) return "mechanism";
  if (field in EMPTY_SNAPSHOT.treatments) return "treatments";
  if (field in EMPTY_SNAPSHOT.responder) return "responder";
  return "notes";
}

export function hasDraftContent(draft: BoardSnapshot): boolean {
  const { identity, mechanism, treatments, responder } = draft;
  const text = [
    identity.lastName,
    identity.firstName,
    identity.allergies,
    identity.battleRosterNumber,
    identity.casualtyLast4,
    identity.service,
    identity.unit,
    mechanism.mechanismOther,
    draft.notes,
    treatments.hypothermiaType,
    treatments.dressingOtherType,
    treatments.circulationTqType,
    treatments.circulationDressingType,
    treatments.airwayType,
    treatments.breathingType,
    responder.responderName,
    responder.responderLast4,
  ].some((value) => Boolean(value?.trim()));
  return (
    text ||
    identity.gender != null ||
    identity.evacPriority != null ||
    identity.injuredAt != null ||
    mechanism.mechanisms.length > 0 ||
    draft.injuries.length > 0 ||
    draft.tourniquets.length > 0 ||
    draft.vitals.length > 0 ||
    draft.fluids.length > 0 ||
    draft.medications.length > 0 ||
    treatments.circulation.length > 0 ||
    treatments.airway.length > 0 ||
    treatments.breathing.length > 0 ||
    treatments.otherTreatments.length > 0 ||
    treatments.tqExtremity ||
    treatments.tqJunctional ||
    treatments.tqTruncal ||
    treatments.combatPillPack ||
    treatments.eyeShieldRight ||
    treatments.eyeShieldLeft
  );
}

export function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function limbForRegion(region: BodyRegion): Limb | null {
  if (region === "RIGHT_ARM") return Limb.RIGHT_ARM;
  if (region === "LEFT_ARM") return Limb.LEFT_ARM;
  if (region === "RIGHT_LEG") return Limb.RIGHT_LEG;
  if (region === "LEFT_LEG") return Limb.LEFT_LEG;
  return null;
}
