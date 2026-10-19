import { BodyView, Limb, newId } from "@tccc/shared";
import { sameMinute } from "@/lib/forms/time";
import type { Dd1380FormSource, Dd1380Values } from "@/components/pages/casualties/dd1380/form-context";
import type { StoredMark } from "@/components/pages/casualties/dd1380/injury-section";
import {
  cardToValues,
  isPaperSite,
  limbSlots,
  markedSites,
  parseCardStamp,
  valuesToCardPatch,
  type SheetSource,
} from "@/components/pages/casualties/dd1380/mapping";
import type { BoardSnapshot, BoardTreatments } from "@/components/pages/casualties/board/snapshot";
import type { BoardStore } from "@/components/pages/casualties/board/store";

/**
 * The DD1380 sheet is a view of the board store, not a second editor. Its values
 * are derived from the store snapshot, and each change becomes ordinary store edits,
 * saved by the same debounce and `commitBoard` as the tactical board.
 */

type SheetPatch = ReturnType<typeof valuesToCardPatch>;
type SheetField = keyof SheetPatch;

const KEY_FIELDS: Readonly<Record<string, readonly SheetField[]>> = {
  name: ["lastName", "firstName"],
  male: ["gender"],
  female: ["gender"],
  date: ["injuredAt"],
  time: ["injuredAt"],
  roster: ["battleRosterNumber"],
  evac_urgent: ["evacPriority"],
  evac_priority: ["evacPriority"],
  evac_routine: ["evacPriority"],
  allergies: ["allergies"],
  last4: ["casualtyLast4"],
  service: ["service"],
  unit: ["unit"],
  mechanism_specify: ["mechanismOther"],
  notes: ["notes"],
  firstResponder_name: ["responderName"],
  firstResponder_last4: ["responderLast4"],
  treatment_C_TQ_Extremity: ["tqExtremity", "circulation"],
  treatment_C_TQ_Junctional: ["tqJunctional", "circulation"],
  treatment_C_TQ_Truncal: ["tqTruncal", "circulation"],
  treatment_C_Dressing_Hemostatic: ["circulation"],
  treatment_C_Dressing_Pressure: ["circulation"],
  treatment_C_Dressing_Other: ["circulation"],
  treatment_C_Dressing_other_specify: ["dressingOtherType"],
  treatment_C_TQ_type: ["circulationTqType"],
  treatment_C_Dressing_type: ["circulationDressingType"],
  treatment_A_type: ["airwayType"],
  treatment_B_type: ["breathingType"],
  treatment_other_CombatPillPack: ["combatPillPack"],
  treatment_other_EyeShield: ["otherTreatments"],
  treatment_other_R: ["eyeShieldRight", "otherTreatments"],
  treatment_other_L: ["eyeShieldLeft", "otherTreatments"],
  treatment_other_Splint: ["otherTreatments"],
  treatment_other_HypothermiaPrevention: ["otherTreatments"],
  treatment_other_type: ["hypothermiaType"],
};

const LIMB_KEY = /^(r_arm|l_arm|r_leg|l_leg)_(?:type|time)$/;
const LIMB_OF_PREFIX: Readonly<Record<string, Limb>> = {
  r_arm: Limb.RIGHT_ARM,
  l_arm: Limb.LEFT_ARM,
  r_leg: Limb.RIGHT_LEG,
  l_leg: Limb.LEFT_LEG,
};

/** PDF rectangle of each figure; a paper site is stored at its position inside it (0..1). */
const FIGURE = {
  [BodyView.FRONT]: { x0: 120.6, y0: 231.85, w: 100.8, h: 226.8 },
  [BodyView.BACK]: { x0: 295.2, y0: 231.85, w: 100.8, h: 226.8 },
} as const;

const IDENTITY_FIELDS = new Set<string>([
  "lastName",
  "firstName",
  "gender",
  "injuredAt",
  "battleRosterNumber",
  "evacPriority",
  "allergies",
  "casualtyLast4",
  "service",
  "unit",
]);
const MECHANISM_FIELDS = new Set<string>(["mechanisms", "mechanismOther"]);
const RESPONDER_FIELDS = new Set<string>(["responderName", "responderLast4"]);

function fieldsOfKey(key: string): readonly SheetField[] {
  const listed = KEY_FIELDS[key];
  if (listed) return listed;
  if (key.startsWith("mechanism_")) return ["mechanisms"];
  if (key.startsWith("treatment_A_")) return ["airway"];
  if (key.startsWith("treatment_B_")) return ["breathing"];
  return [];
}

interface SheetPlan {
  identity: Partial<BoardSnapshot["identity"]>;
  mechanism: Partial<BoardSnapshot["mechanism"]>;
  treatments: Partial<BoardTreatments>;
  responder: Partial<BoardSnapshot["responder"]>;
  /** `undefined`: notes unchanged. */
  notes?: string | null;
  /** A blank `type` removes the tourniquet; no `appliedAt` keeps the stored time or stamps a new one now. */
  tourniquets: { limb: Limb; type: string; appliedAt?: string }[];
  injuries?: BoardSnapshot["injuries"];
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function currentField(snapshot: BoardSnapshot, field: SheetField): unknown {
  if (field === "notes") return snapshot.notes;
  if (IDENTITY_FIELDS.has(field)) return snapshot.identity[field as keyof BoardSnapshot["identity"]];
  if (MECHANISM_FIELDS.has(field)) return snapshot.mechanism[field as keyof BoardSnapshot["mechanism"]];
  if (RESPONDER_FIELDS.has(field)) return snapshot.responder[field as keyof BoardSnapshot["responder"]];
  return snapshot.treatments[field as keyof BoardTreatments];
}

/** The store edits that `keys` of `values` stand for. Unchanged fields and unfinished text (a date without a time) are left out. */
function planSheet(snapshot: BoardSnapshot, values: Dd1380Values, keys: readonly string[]): SheetPlan {
  const plan: SheetPlan = { identity: {}, mechanism: {}, treatments: {}, responder: {}, tourniquets: [] };
  const patch = valuesToCardPatch(values);
  const fields = new Set(keys.flatMap(fieldsOfKey));
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined || sameJson(value, currentField(snapshot, field))) continue;
    if (field === "notes") plan.notes = value as string | null;
    else if (IDENTITY_FIELDS.has(field)) Object.assign(plan.identity, { [field]: value });
    else if (MECHANISM_FIELDS.has(field)) Object.assign(plan.mechanism, { [field]: value });
    else if (RESPONDER_FIELDS.has(field)) Object.assign(plan.responder, { [field]: value });
    else Object.assign(plan.treatments, { [field]: value });
  }

  const limbs = new Set(keys.flatMap((key) => LIMB_KEY.exec(key)?.[1] ?? []).map((prefix) => LIMB_OF_PREFIX[prefix]!));
  for (const slot of limbSlots(values)) {
    if (!limbs.has(slot.limb)) continue;
    const existing = snapshot.tourniquets.find((row) => row.limb === slot.limb);
    if (!slot.type) {
      if (existing) plan.tourniquets.push({ limb: slot.limb, type: "" });
      continue;
    }
    // A blank or unfinished time keeps the stored one. Paper times hold minutes only,
    // so a time that reads back as the same minute is not rewritten.
    const typed = parseCardStamp("", slot.time, { near: existing?.appliedAt, notBefore: snapshot.identity.injuredAt });
    const appliedAt = typed && !(existing && sameMinute(existing.appliedAt, typed)) ? typed : existing?.appliedAt;
    const type = slot.type.slice(0, 50);
    if (existing && existing.type === type && existing.appliedAt === appliedAt) continue;
    plan.tourniquets.push({ limb: slot.limb, type, appliedAt });
  }

  if (keys.some((key) => isPaperSite(key))) {
    const marked = markedSites(values);
    const wanted = new Set(marked.map((site) => site.id));
    const kept = snapshot.injuries.filter((row) => !isPaperSite(row.siteCode) || wanted.has(row.siteCode!));
    const placed = new Set(kept.map((row) => row.siteCode));
    const added = marked
      .filter((site) => !placed.has(site.id))
      .map((site) => {
        const id = newId();
        const box = FIGURE[site.view];
        return {
          id,
          region: site.region,
          view: site.view,
          x: Math.min(1, Math.max(0, (site.x - box.x0) / box.w)),
          y: Math.min(1, Math.max(0, (site.y - box.y0) / box.h)),
          siteCode: site.id,
          description: null,
          clientUpdatedAt: "",
          deletedAt: null,
        };
      });
    if (added.length > 0 || kept.length !== snapshot.injuries.length) plan.injuries = [...kept, ...added];
  }
  return plan;
}

function isNoop(plan: SheetPlan): boolean {
  return (
    Object.keys(plan.identity).length === 0 &&
    Object.keys(plan.mechanism).length === 0 &&
    Object.keys(plan.treatments).length === 0 &&
    Object.keys(plan.responder).length === 0 &&
    plan.notes === undefined &&
    plan.tourniquets.length === 0 &&
    plan.injuries === undefined
  );
}

function sheetSource(snapshot: BoardSnapshot): SheetSource {
  return {
    ...snapshot.identity,
    ...snapshot.mechanism,
    ...snapshot.treatments,
    notes: snapshot.notes,
    ...snapshot.responder,
    tourniquets: snapshot.tourniquets,
    injurySites: snapshot.injuries,
  };
}

/**
 * The sheet's field values. Typed text replaces the derived value while it still
 * means the same thing ("Van " for "Van") or is unfinished (a date without a time).
 * Text a newer card value has made stale is dropped, so a remote edit shows.
 */
export function sheetValues(snapshot: BoardSnapshot): Dd1380Values {
  const cached = valuesBySnapshot.get(snapshot);
  if (cached) return cached;
  const values = computeSheetValues(snapshot);
  valuesBySnapshot.set(snapshot, values);
  return values;
}

/** One computation per snapshot, shared by every field of the sheet. */
const valuesBySnapshot = new WeakMap<BoardSnapshot, Dd1380Values>();

function computeSheetValues(snapshot: BoardSnapshot): Dd1380Values {
  const base = cardToValues(sheetSource(snapshot));
  const typed = snapshot.sheetText;
  const keys = Object.keys(typed);
  if (keys.length === 0) return base;
  const withTyped = { ...base, ...typed };
  const values: Record<string, string | boolean> = { ...base };
  for (const key of keys) {
    const text = typed[key]!;
    if (base[key] === text) continue;
    if (isNoop(planSheet(snapshot, withTyped, [key]))) values[key] = text;
  }
  return values;
}

/** Marks drawn on the sheet's figures. Takes the injury list so callers can memoize on it alone. */
export function sheetMarks(injuries: BoardSnapshot["injuries"]): StoredMark[] {
  return injuries
    .filter((row) => row.x != null && row.y != null)
    .map((row) => ({ id: row.id, view: row.view, x: row.x ?? 0, y: row.y ?? 0, siteCode: row.siteCode }));
}

/** Applies sheet field changes to the store. Checkboxes save at once; typed text after the debounce. */
export function applySheetChange(store: BoardStore, changes: Readonly<Record<string, string | boolean>>): void {
  const snapshot = store.getSnapshot();
  const current = sheetValues(snapshot);
  const keys = Object.keys(changes).filter((key) => changes[key] !== current[key]);
  if (keys.length === 0) return;
  const next = { ...current, ...changes };
  const text = Object.fromEntries(keys.flatMap((key) => (typeof changes[key] === "string" ? [[key, changes[key] as string]] : [])));
  if (Object.keys(text).length > 0) store.setSheetText(text);

  const plan = planSheet(snapshot, next, keys);
  const when = keys.every((key) => typeof next[key] === "boolean") ? "now" : "debounce";
  if (Object.keys(plan.identity).length > 0) store.editIdentity(plan.identity, when);
  if (Object.keys(plan.mechanism).length > 0) store.editMechanism(plan.mechanism, when);
  if (Object.keys(plan.treatments).length > 0) store.editTreatments(plan.treatments, when);
  if (Object.keys(plan.responder).length > 0) store.editResponder(plan.responder);
  if (plan.notes !== undefined) store.editNotes(plan.notes ?? "");
  for (const tourniquet of plan.tourniquets) store.setLimbTourniquet(tourniquet.limb, tourniquet.type, tourniquet.appliedAt);
  if (plan.injuries) store.editInjuries(plan.injuries);
}

/**
 * The sheet's form source over a board store: fields read the values derived from
 * the store snapshot and write through `applySheetChange`. Stable for a store.
 */
export function sheetFormSource(store: BoardStore): Dd1380FormSource {
  return {
    getValues: () => sheetValues(store.getSnapshot()),
    subscribe: store.subscribe,
    patch: (changes) => applySheetChange(store, changes),
  };
}
