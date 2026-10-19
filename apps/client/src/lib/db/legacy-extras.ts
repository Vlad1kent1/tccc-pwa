import {
  CirculationTreatment,
  emptyCardFields,
  formatHlc,
  initialHlc,
  newId,
  tickHlc,
  type CardField,
  type CardPatch,
  type HlcState,
} from "@tccc/shared";
import type { Table } from "dexie";
import { cleanCardPatch } from "@/lib/forms/card-patch";
import { getMeta, setMeta } from "./meta";
import type { TcccDB } from "./schema";

/**
 * Before Dexie v3, paper-card details lived outside the card schema: in this
 * localStorage bag (written on each keystroke) and in an untyped `paperExtras`
 * property on the IndexedDB record (written later). Neither was synced. This
 * module moves both into the card fields and queues them for sync.
 */
export const LEGACY_BAG_KEY = "tccc.dd1380.extras";
/** Bag entry of a new card that was never created; it has no card to move into. */
const DRAFT_ID = "draft";
const TEXT_MAX = 100;
const DRAFT_TEXT_MAX = 200;

interface LegacyExtras {
  last4: string;
  service: string;
  unit: string;
  tqExtremity: boolean;
  tqJunctional: boolean;
  tqTruncal: boolean;
  combatPillPack: boolean;
  eyeRight: boolean;
  eyeLeft: boolean;
  hypothermiaType: string;
  dressingOtherType: string;
  treatmentTypeC: string;
  treatmentTypeDressing: string;
  treatmentTypeA: string;
  treatmentTypeB: string;
  fieldDrafts: Record<string, Record<string, string>>;
}

type LegacyBag = Record<string, unknown>;

function text(raw: Record<string, unknown>, key: string, previous?: string): string {
  if (typeof raw[key] === "string") return raw[key];
  // `dressingOtherType` was once stored as `dressingOther`.
  if (previous && typeof raw[previous] === "string") return raw[previous];
  return "";
}

function normalizeDrafts(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object") return {};
  const drafts: Record<string, Record<string, string>> = {};
  for (const [id, fields] of Object.entries(value)) {
    if (!fields || typeof fields !== "object") continue;
    const row: Record<string, string> = {};
    for (const [key, cell] of Object.entries(fields)) {
      if (typeof cell === "string" && cell !== "") row[key] = cell.slice(0, DRAFT_TEXT_MAX);
    }
    if (Object.keys(row).length > 0) drafts[id] = row;
  }
  return drafts;
}

function normalizeLegacy(value: unknown): LegacyExtras | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    last4: text(raw, "last4"),
    service: text(raw, "service"),
    unit: text(raw, "unit"),
    tqExtremity: raw.tqExtremity === true,
    tqJunctional: raw.tqJunctional === true,
    tqTruncal: raw.tqTruncal === true,
    combatPillPack: raw.combatPillPack === true,
    eyeRight: raw.eyeRight === true,
    eyeLeft: raw.eyeLeft === true,
    hypothermiaType: text(raw, "hypothermiaType"),
    dressingOtherType: text(raw, "dressingOtherType", "dressingOther"),
    treatmentTypeC: text(raw, "treatmentTypeC"),
    treatmentTypeDressing: text(raw, "treatmentTypeDressing"),
    treatmentTypeA: text(raw, "treatmentTypeA"),
    treatmentTypeB: text(raw, "treatmentTypeB"),
    fieldDrafts: normalizeDrafts(raw.fieldDrafts),
  };
}

/**
 * Same precedence the old screens used: the bag was written on every keystroke and
 * the IndexedDB copy lagged it, so non-blank bag text wins and a checkbox set in
 * either copy stays set.
 */
function mergeLegacy(embedded: LegacyExtras | null, cached: LegacyExtras | null): LegacyExtras | null {
  if (!embedded) return cached;
  if (!cached) return embedded;
  const pick = (live: string, stored: string) => (live.trim() ? live : stored);
  return {
    last4: pick(cached.last4, embedded.last4),
    service: pick(cached.service, embedded.service),
    unit: pick(cached.unit, embedded.unit),
    tqExtremity: embedded.tqExtremity || cached.tqExtremity,
    tqJunctional: embedded.tqJunctional || cached.tqJunctional,
    tqTruncal: embedded.tqTruncal || cached.tqTruncal,
    combatPillPack: embedded.combatPillPack || cached.combatPillPack,
    eyeRight: embedded.eyeRight || cached.eyeRight,
    eyeLeft: embedded.eyeLeft || cached.eyeLeft,
    hypothermiaType: pick(cached.hypothermiaType, embedded.hypothermiaType),
    dressingOtherType: pick(cached.dressingOtherType, embedded.dressingOtherType),
    treatmentTypeC: pick(cached.treatmentTypeC, embedded.treatmentTypeC),
    treatmentTypeDressing: pick(cached.treatmentTypeDressing, embedded.treatmentTypeDressing),
    treatmentTypeA: pick(cached.treatmentTypeA, embedded.treatmentTypeA),
    treatmentTypeB: pick(cached.treatmentTypeB, embedded.treatmentTypeB),
    fieldDrafts: Object.keys(cached.fieldDrafts).length > 0 ? cached.fieldDrafts : embedded.fieldDrafts,
  };
}

/**
 * Card fields for one card's legacy extras. A card with TOURNIQUET but no placement
 * gets Extremity, which is what the old screens showed and printed for it. Values
 * the schema rejects (e.g. an unfinished last 4) are dropped and logged.
 */
export function legacyCardPatch(
  card: { id: string; circulation?: readonly string[] },
  embedded: unknown,
  cached: unknown,
): CardPatch {
  const legacy = mergeLegacy(normalizeLegacy(embedded), normalizeLegacy(cached));
  const clip = (value: string | undefined) => value?.slice(0, TEXT_MAX);
  const raw: Record<string, unknown> = legacy
    ? {
        casualtyLast4: legacy.last4,
        service: clip(legacy.service),
        unit: clip(legacy.unit),
        tqExtremity: legacy.tqExtremity,
        tqJunctional: legacy.tqJunctional,
        tqTruncal: legacy.tqTruncal,
        dressingOtherType: clip(legacy.dressingOtherType),
        circulationTqType: clip(legacy.treatmentTypeC),
        circulationDressingType: clip(legacy.treatmentTypeDressing),
        airwayType: clip(legacy.treatmentTypeA),
        breathingType: clip(legacy.treatmentTypeB),
        combatPillPack: legacy.combatPillPack,
        eyeShieldRight: legacy.eyeRight,
        eyeShieldLeft: legacy.eyeLeft,
        hypothermiaType: clip(legacy.hypothermiaType),
        rowDrafts: legacy.fieldDrafts,
      }
    : {};
  const placed = raw.tqExtremity === true || raw.tqJunctional === true || raw.tqTruncal === true;
  if (!placed && card.circulation?.includes(CirculationTreatment.TOURNIQUET)) raw.tqExtremity = true;

  const { patch, invalid } = cleanCardPatch(raw);
  if (invalid.length > 0) console.warn("Legacy paper fields dropped as invalid", card.id, invalid);
  return patch;
}

const DEFAULTS = emptyCardFields();

/** Fields whose value differs from a new card's default. Only these need a clock and a sync. */
function nonDefault(patch: CardPatch): CardField[] {
  return (Object.keys(patch) as CardField[]).filter(
    (field) => JSON.stringify(patch[field]) !== JSON.stringify(DEFAULTS[field]),
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The legacy bag, `{}` when this context has localStorage but no bag, or `null`
 * when it has no localStorage (a service worker) and the bag cannot be read.
 */
export function readLegacyBag(): LegacyBag | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(LEGACY_BAG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LegacyBag) : {};
  } catch {
    return {};
  }
}

export interface UpgradeTables {
  casualties: Table;
  outbox: Table;
  meta: Table;
}

/**
 * Dexie v3 upgrade. Gives every card the new fields, fills them from `paperExtras`
 * and the bag, drops `paperExtras`, and queues one `card.upsert` per changed card
 * so the values reach the server. The bag itself is removed later by
 * `finishLegacyExtrasMigration`, after this transaction has committed.
 */
export async function migrateLegacyExtras(tables: UpgradeTables, bag: LegacyBag | null, now = Date.now()): Promise<void> {
  const deviceEntry = (await tables.meta.get("deviceId")) as { value?: string } | undefined;
  const deviceId = deviceEntry?.value ?? newId();
  if (!deviceEntry?.value) await tables.meta.put({ key: "deviceId", value: deviceId });
  const clockEntry = (await tables.meta.get("hlcState")) as { value?: HlcState } | undefined;
  let clock = clockEntry?.value ?? initialHlc(deviceId);

  const cards = (await tables.casualties.toArray()) as Array<Record<string, unknown> & { id: string }>;
  for (const stored of cards) {
    const { paperExtras, ...card } = stored;
    for (const [field, value] of Object.entries(DEFAULTS)) {
      if (!(field in card)) card[field] = value;
    }

    const patch = legacyCardPatch(
      { id: card.id, circulation: card.circulation as string[] | undefined },
      paperExtras,
      bag?.[card.id],
    );
    const changed = nonDefault(patch);
    if (changed.length > 0) {
      clock = tickHlc(clock, now);
      const hlc = formatHlc(clock);
      const effective = Object.fromEntries(changed.map((field) => [field, patch[field]])) as CardPatch;
      Object.assign(card, effective);
      card.fieldClock = {
        ...(card.fieldClock as Record<string, string> | undefined),
        ...Object.fromEntries(changed.map((field) => [field, hlc])),
      };
      card.clientUpdatedAt = hlc;
      if (card.syncStatus !== "conflict") card.syncStatus = "pending";
      if (card.deletedAt == null) {
        await tables.outbox.add({
          op: "card.upsert",
          mutationId: newId(),
          cardId: card.id,
          hlc,
          baseVersion: (card.serverVersion as number | null | undefined) ?? null,
          patch: effective,
          changedFields: changed,
          status: "queued",
          attempts: 0,
          createdAt: now,
        });
      }
    }
    await tables.casualties.put(card);
  }

  await tables.meta.put({ key: "hlcState", value: clock });
  // Only a context that could read the bag has merged it.
  if (bag !== null) await tables.meta.put({ key: "legacyBagMigrated", value: true });
}

/**
 * Runs in a window after the database opens. Removes the bag once its values are in
 * the cards. When the upgrade ran without localStorage (a service worker), it fills
 * card fields that are still at their default from the bag first, through the
 * repository so each change is stamped and queued like any other edit.
 */
export async function finishLegacyExtrasMigration(
  db: TcccDB,
  updateFields: (id: string, patch: CardPatch) => Promise<unknown>,
): Promise<void> {
  const store = storage();
  if (!store || store.getItem(LEGACY_BAG_KEY) == null) return;

  if (!(await getMeta(db, "legacyBagMigrated"))) {
    const bag = readLegacyBag() ?? {};
    for (const [id, cached] of Object.entries(bag)) {
      if (id === DRAFT_ID) continue;
      const card = await db.casualties.get(id);
      if (!card || card.deletedAt) continue;
      const patch = legacyCardPatch(card, null, cached);
      const fill = nonDefault(patch).filter(
        (field) => JSON.stringify(card[field]) === JSON.stringify(DEFAULTS[field]),
      );
      if (fill.length === 0) continue;
      await updateFields(id, Object.fromEntries(fill.map((field) => [field, patch[field]])) as CardPatch);
    }
    await setMeta(db, "legacyBagMigrated", true);
  }
  store.removeItem(LEGACY_BAG_KEY);
}
