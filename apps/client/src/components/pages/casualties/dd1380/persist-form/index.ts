import Dexie from "dexie";
import {
  BodyView,
  FluidKind,
  MedicationCategory,
  newId,
  type CardPatch,
  type Fluid,
  type Medication,
  type VitalSigns,
} from "@tccc/shared";
import { type CasualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import type { Dd1380Values } from "@/components/pages/casualties/dd1380/form-context";
import {
  intField,
  limbSlots,
  markedSites,
  parseAvpu,
  parseCardStamp,
  parsePain,
  parseRoute,
  parseVolume,
  pulseParts,
  slotKey,
  str,
  valuesToCardPatch,
  vitalSlotKey,
} from "@/components/pages/casualties/dd1380/mapping";

export interface SlotId {
  key: string;
  id: string;
}

export type PersistResult =
  | { status: "aborted" }
  | { status: "saved"; clientUpdatedAt: string; assigned: SlotId[]; cleared: SlotId[] };

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ensureCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Dexie.AbortError();
}

function textId(values: Dd1380Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" && value ? value : undefined;
}

function activeById<T extends { id: string; deletedAt: string | null }>(rows: T[], id: string | undefined): T | undefined {
  if (!id) return undefined;
  return rows.find((row) => row.id === id && row.deletedAt == null);
}

/**
 * Writes one DD 1380 edit in a single Dexie transaction. The card is re-read
 * inside that transaction. A stale generation throws `AbortError`, which rolls
 * the transaction back so a slower save cannot land after a newer one.
 */
export async function persistForm(
  repo: CasualtyRepo,
  cardId: string,
  values: Dd1380Values,
  isCurrent: () => boolean,
): Promise<PersistResult> {
  if (!isCurrent()) return { status: "aborted" };
  const assigned: SlotId[] = [];
  const cleared: SlotId[] = [];
  try {
    const clientUpdatedAt = await repo.readWrite(async () => {
      ensureCurrent(isCurrent);
      let card = await requireCard(repo, cardId);
      const patch = changedPatch(card, valuesToCardPatch(values));
      if (Object.keys(patch).length > 0) {
        ensureCurrent(isCurrent);
        card = await repo.updateFields(card.id, patch);
      }
      ensureCurrent(isCurrent);
      await persistTourniquets(repo, card, values, isCurrent);
      card = await requireCard(repo, cardId);
      ensureCurrent(isCurrent);
      await persistVitals(repo, card, values, assigned, cleared, isCurrent);
      card = await requireCard(repo, cardId);
      ensureCurrent(isCurrent);
      await persistFluids(repo, card, values, assigned, cleared, isCurrent);
      card = await requireCard(repo, cardId);
      ensureCurrent(isCurrent);
      await persistMeds(repo, card, values, assigned, cleared, isCurrent);
      card = await requireCard(repo, cardId);
      ensureCurrent(isCurrent);
      await persistInjuries(repo, card, values, isCurrent);
      return (await requireCard(repo, cardId)).clientUpdatedAt;
    });
    return { status: "saved", clientUpdatedAt, assigned, cleared };
  } catch (error) {
    if (error instanceof Dexie.AbortError) return { status: "aborted" };
    throw error;
  }
}

async function requireCard(repo: CasualtyRepo, cardId: string): Promise<LocalCasualtyCard> {
  const card = await repo.getById(cardId);
  if (!card || card.deletedAt) throw new Dexie.AbortError();
  return card;
}

function changedPatch(card: LocalCasualtyCard, patch: ReturnType<typeof valuesToCardPatch>): CardPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => !sameJson(card[key as keyof CardPatch], value)),
  ) as CardPatch;
}

async function persistTourniquets(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  values: Dd1380Values,
  isCurrent: () => boolean,
): Promise<void> {
  for (const slot of limbSlots(values)) {
    ensureCurrent(isCurrent);
    const existing = card.tourniquets.find((row) => row.limb === slot.limb && row.deletedAt == null);
    if (!slot.type) {
      if (existing) await repo.deleteChild(card.id, "tourniquet", existing.id);
      continue;
    }
    const appliedAt = parseCardStamp("", slot.time, existing?.appliedAt ?? card.injuredAt) ?? new Date().toISOString();
    if (existing && existing.type === slot.type && existing.appliedAt === appliedAt) continue;
    await repo.upsertChild(card.id, "tourniquet", { limb: slot.limb, type: slot.type.slice(0, 50), appliedAt });
  }
}

async function persistVitals(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  values: Dd1380Values,
  assigned: SlotId[],
  cleared: SlotId[],
  isCurrent: () => boolean,
): Promise<void> {
  for (let i = 0; i < 4; i++) {
    ensureCurrent(isCurrent);
    const n = i + 1;
    const key = vitalSlotKey(n);
    const pinned = textId(values, key);
    const pulse = pulseParts(str(values[`pulse${n}`]));
    const desired = {
      measuredAt: "",
      pulseRate: pulse.pulseRate,
      pulseLocation: pulse.pulseLocation,
      systolic: intField(str(values[`bloodPressureA${n}`]), 0, 300),
      diastolic: intField(str(values[`bloodPressureB${n}`]), 0, 200),
      respiratoryRate: intField(str(values[`respRate${n}`]), 0, 80),
      spo2: intField(str(values[`o2sat${n}`]), 0, 100),
      avpu: parseAvpu(str(values[`avpu${n}`])),
      painScale: parsePain(str(values[`pain${n}`])),
    };
    const has = Object.values(desired).some((item, index) => index > 0 && item != null && item !== "");
    const existing = activeById(card.vitalSigns, pinned);
    if (!has) {
      if (existing) {
        await repo.deleteChild(card.id, "vitalSigns", existing.id);
        cleared.push({ key, id: existing.id });
      }
      continue;
    }
    const id = pinned ?? newId();
    if (!pinned) assigned.push({ key, id });
    desired.measuredAt = parseCardStamp("", str(values[`time${n}`]), existing?.measuredAt ?? card.injuredAt) ?? new Date().toISOString();
    if (sameVital(existing, desired)) continue;
    await repo.upsertChild(card.id, "vitalSigns", { id, ...desired });
  }
}

function sameVital(existing: VitalSigns | undefined, desired: Omit<VitalSigns, "id" | "cardId" | "clientUpdatedAt" | "deletedAt">): boolean {
  if (!existing) return false;
  return (
    existing.measuredAt === desired.measuredAt &&
    existing.pulseRate === desired.pulseRate &&
    existing.pulseLocation === desired.pulseLocation &&
    existing.systolic === desired.systolic &&
    existing.diastolic === desired.diastolic &&
    existing.respiratoryRate === desired.respiratoryRate &&
    existing.spo2 === desired.spo2 &&
    existing.avpu === desired.avpu &&
    existing.painScale === desired.painScale
  );
}

async function persistFluids(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  values: Dd1380Values,
  assigned: SlotId[],
  cleared: SlotId[],
  isCurrent: () => boolean,
): Promise<void> {
  const kinds = [
    { kind: FluidKind.FLUID, prefix: "treatment_C_Fluid", slots: 2 },
    { kind: FluidKind.BLOOD_PRODUCT, prefix: "treatment_C_BloodProduct", slots: 2 },
  ] as const;
  for (const group of kinds) {
    for (let i = 0; i < group.slots; i++) {
      ensureCurrent(isCurrent);
      const n = i + 1;
      const key = slotKey(group.prefix, n);
      const pinned = textId(values, key);
      const name = str(values[`${group.prefix}_Name${n}`]).trim();
      const volumeMl = parseVolume(str(values[`${group.prefix}_Volume${n}`]));
      const route = parseRoute(str(values[`${group.prefix}_Route${n}`]));
      const existing = activeById(card.fluids, pinned);
      if (!name || volumeMl == null || !route) {
        if (existing) {
          await repo.deleteChild(card.id, "fluid", existing.id);
          cleared.push({ key, id: existing.id });
        }
        continue;
      }
      const id = pinned ?? newId();
      if (!pinned) assigned.push({ key, id });
      const administeredAt =
        parseCardStamp("", str(values[`${group.prefix}_Time${n}`]), existing?.administeredAt ?? card.injuredAt) ??
        new Date().toISOString();
      const desired = { kind: group.kind, name: name.slice(0, 100), volumeMl, route, administeredAt };
      if (sameFluid(existing, desired)) continue;
      await repo.upsertChild(card.id, "fluid", { id, ...desired });
    }
  }
}

function sameFluid(existing: Fluid | undefined, desired: Omit<Fluid, "id" | "cardId" | "clientUpdatedAt" | "deletedAt">): boolean {
  if (!existing) return false;
  return (
    existing.kind === desired.kind &&
    existing.name === desired.name &&
    existing.volumeMl === desired.volumeMl &&
    existing.route === desired.route &&
    existing.administeredAt === desired.administeredAt
  );
}

async function persistMeds(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  values: Dd1380Values,
  assigned: SlotId[],
  cleared: SlotId[],
  isCurrent: () => boolean,
): Promise<void> {
  const groups = [
    { category: MedicationCategory.ANALGESIC, prefix: "treatment_MEDS_Analgesic", slots: 3 },
    { category: MedicationCategory.ANTIBIOTIC, prefix: "treatment_MEDS_Antibiotic", slots: 2 },
    { category: MedicationCategory.OTHER, prefix: "treatment_MEDS_Other", slots: 2 },
  ] as const;
  for (const group of groups) {
    for (let i = 0; i < group.slots; i++) {
      ensureCurrent(isCurrent);
      const n = i + 1;
      const key = slotKey(group.prefix, n);
      const pinned = textId(values, key);
      const name = str(values[`${group.prefix}_Name${n}`]).trim();
      const dose = str(values[`${group.prefix}_Dose${n}`]).trim();
      const route = parseRoute(str(values[`${group.prefix}_Route${n}`]));
      const existing = activeById(card.medications, pinned);
      if (!name || !dose || !route) {
        if (existing) {
          await repo.deleteChild(card.id, "medication", existing.id);
          cleared.push({ key, id: existing.id });
        }
        continue;
      }
      const id = pinned ?? newId();
      if (!pinned) assigned.push({ key, id });
      const administeredAt =
        parseCardStamp("", str(values[`${group.prefix}_Time${n}`]), existing?.administeredAt ?? card.injuredAt) ??
        new Date().toISOString();
      const desired = {
        category: group.category,
        name: name.slice(0, 100),
        dose: dose.slice(0, 50),
        route,
        administeredAt,
      };
      if (sameMed(existing, desired)) continue;
      await repo.upsertChild(card.id, "medication", { id, ...desired });
    }
  }
}

function sameMed(
  existing: Medication | undefined,
  desired: Omit<Medication, "id" | "cardId" | "clientUpdatedAt" | "deletedAt">,
): boolean {
  if (!existing) return false;
  return (
    existing.category === desired.category &&
    existing.name === desired.name &&
    existing.dose === desired.dose &&
    existing.route === desired.route &&
    existing.administeredAt === desired.administeredAt
  );
}

async function persistInjuries(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  values: Dd1380Values,
  isCurrent: () => boolean,
): Promise<void> {
  const marked = markedSites(values);
  const existing = card.injurySites.filter((row) => row.deletedAt == null);
  const wanted = new Set(marked.map((site) => site.id));
  for (const row of existing) {
    ensureCurrent(isCurrent);
    if (row.description && !wanted.has(row.description)) {
      await repo.deleteChild(card.id, "injurySite", row.id);
    }
  }
  for (const site of marked) {
    ensureCurrent(isCurrent);
    if (existing.some((item) => item.description === site.id)) continue;
    const figure = site.view === BodyView.FRONT ? { x0: 120.6, y0: 231.85, w: 100.8, h: 226.8 } : { x0: 295.2, y0: 231.85, w: 100.8, h: 226.8 };
    await repo.upsertChild(card.id, "injurySite", {
      region: site.region,
      view: site.view,
      x: Math.min(1, Math.max(0, (site.x - figure.x0) / figure.w)),
      y: Math.min(1, Math.max(0, (site.y - figure.y0) / figure.h)),
      description: site.id,
    });
  }
}
