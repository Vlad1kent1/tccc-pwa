import Dexie from "dexie";
import type { CardPatch } from "@tccc/shared";
import type { CasualtyRepo, LocalCasualtyCard } from "@/lib/db";
import type { BoardSlice, BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

export type CommitResult = { status: "aborted" } | { status: "saved"; clientUpdatedAt: string };

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ensure(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Dexie.AbortError();
}

function active<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt == null);
}

/**
 * Writes the dirty slices of one board edit in a single Dexie transaction.
 * Child rows are matched by id. A newer edit aborts this transaction.
 */
export async function commitBoard(
  repo: CasualtyRepo,
  cardId: string,
  draft: BoardSnapshot,
  dirty: ReadonlySet<BoardSlice>,
  patch: CardPatch,
  isCurrent: () => boolean,
): Promise<CommitResult> {
  if (!isCurrent()) return { status: "aborted" };
  try {
    const clientUpdatedAt = await repo.readWrite(async () => {
      ensure(isCurrent);
      const card = await requireCard(repo, cardId);
      const fields = changedFields(card, patch);
      if (Object.keys(fields).length > 0) {
        ensure(isCurrent);
        await repo.updateFields(card.id, fields);
      }
      if (dirty.has("body")) {
        ensure(isCurrent);
        await syncInjuries(repo, card, draft, isCurrent);
        await syncTourniquets(repo, await requireCard(repo, cardId), draft, isCurrent);
      }
      if (dirty.has("vitals")) {
        ensure(isCurrent);
        await syncVitals(repo, await requireCard(repo, cardId), draft, isCurrent);
      }
      if (dirty.has("fluids")) {
        ensure(isCurrent);
        await syncFluids(repo, await requireCard(repo, cardId), draft, isCurrent);
      }
      if (dirty.has("meds")) {
        ensure(isCurrent);
        await syncMeds(repo, await requireCard(repo, cardId), draft, isCurrent);
      }
      return (await requireCard(repo, cardId)).clientUpdatedAt;
    });
    return { status: "saved", clientUpdatedAt };
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

function changedFields(card: LocalCasualtyCard, patch: CardPatch): CardPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => !sameJson(card[key as keyof CardPatch], value))) as CardPatch;
}

async function syncInjuries(repo: CasualtyRepo, card: LocalCasualtyCard, draft: BoardSnapshot, isCurrent: () => boolean): Promise<void> {
  const wanted = new Set(draft.injuries.map((row) => row.description).filter((item): item is string => Boolean(item)));
  for (const row of active(card.injurySites)) {
    ensure(isCurrent);
    if (row.description && !wanted.has(row.description)) await repo.deleteChild(card.id, "injurySite", row.id);
  }
  for (const row of draft.injuries) {
    ensure(isCurrent);
    const existing = card.injurySites.find((item) => item.description === row.description);
    const id = existing?.id ?? row.id;
    if (existing && !existing.deletedAt && existing.region === row.region && existing.view === row.view && existing.x === row.x && existing.y === row.y) {
      continue;
    }
    await repo.upsertChild(card.id, "injurySite", {
      id,
      region: row.region,
      view: row.view,
      x: row.x,
      y: row.y,
      description: row.description,
    });
  }
}

async function syncTourniquets(repo: CasualtyRepo, card: LocalCasualtyCard, draft: BoardSnapshot, isCurrent: () => boolean): Promise<void> {
  const wanted = new Set(draft.tourniquets.map((row) => row.limb));
  for (const row of active(card.tourniquets)) {
    ensure(isCurrent);
    if (!wanted.has(row.limb)) await repo.deleteChild(card.id, "tourniquet", row.id);
  }
  for (const row of draft.tourniquets) {
    ensure(isCurrent);
    const existing = active(card.tourniquets).find((item) => item.limb === row.limb);
    if (existing && existing.type === row.type && existing.appliedAt === row.appliedAt) continue;
    await repo.upsertChild(card.id, "tourniquet", { limb: row.limb, type: row.type, appliedAt: row.appliedAt });
  }
}

async function syncVitals(repo: CasualtyRepo, card: LocalCasualtyCard, draft: BoardSnapshot, isCurrent: () => boolean): Promise<void> {
  const wanted = new Set(draft.vitals.map((row) => row.id));
  for (const row of active(card.vitalSigns)) {
    ensure(isCurrent);
    if (!wanted.has(row.id)) await repo.deleteChild(card.id, "vitalSigns", row.id);
  }
  for (const row of draft.vitals) {
    ensure(isCurrent);
    const existing = active(card.vitalSigns).find((item) => item.id === row.id);
    if (
      existing &&
      existing.measuredAt === row.measuredAt &&
      existing.pulseRate === row.pulseRate &&
      existing.pulseLocation === row.pulseLocation &&
      existing.systolic === row.systolic &&
      existing.diastolic === row.diastolic &&
      existing.respiratoryRate === row.respiratoryRate &&
      existing.spo2 === row.spo2 &&
      existing.avpu === row.avpu &&
      existing.painScale === row.painScale
    ) {
      continue;
    }
    await repo.upsertChild(card.id, "vitalSigns", {
      id: row.id,
      measuredAt: row.measuredAt,
      pulseRate: row.pulseRate,
      pulseLocation: row.pulseLocation,
      systolic: row.systolic,
      diastolic: row.diastolic,
      respiratoryRate: row.respiratoryRate,
      spo2: row.spo2,
      avpu: row.avpu,
      painScale: row.painScale,
    });
  }
}

async function syncFluids(repo: CasualtyRepo, card: LocalCasualtyCard, draft: BoardSnapshot, isCurrent: () => boolean): Promise<void> {
  const wanted = new Set(draft.fluids.map((row) => row.id));
  for (const row of active(card.fluids)) {
    ensure(isCurrent);
    if (!wanted.has(row.id)) await repo.deleteChild(card.id, "fluid", row.id);
  }
  for (const row of draft.fluids) {
    ensure(isCurrent);
    const existing = active(card.fluids).find((item) => item.id === row.id);
    if (existing && existing.name === row.name && existing.volumeMl === row.volumeMl && existing.route === row.route && existing.kind === row.kind && existing.administeredAt === row.administeredAt) {
      continue;
    }
    await repo.upsertChild(card.id, "fluid", {
      id: row.id,
      kind: row.kind,
      name: row.name,
      volumeMl: row.volumeMl,
      route: row.route,
      administeredAt: row.administeredAt,
    });
  }
}

async function syncMeds(repo: CasualtyRepo, card: LocalCasualtyCard, draft: BoardSnapshot, isCurrent: () => boolean): Promise<void> {
  const wanted = new Set(draft.medications.map((row) => row.id));
  for (const row of active(card.medications)) {
    ensure(isCurrent);
    if (!wanted.has(row.id)) await repo.deleteChild(card.id, "medication", row.id);
  }
  for (const row of draft.medications) {
    ensure(isCurrent);
    const existing = active(card.medications).find((item) => item.id === row.id);
    if (existing && existing.name === row.name && existing.dose === row.dose && existing.route === row.route && existing.category === row.category && existing.administeredAt === row.administeredAt) {
      continue;
    }
    await repo.upsertChild(card.id, "medication", {
      id: row.id,
      category: row.category,
      name: row.name,
      dose: row.dose,
      route: row.route,
      administeredAt: row.administeredAt,
    });
  }
}
