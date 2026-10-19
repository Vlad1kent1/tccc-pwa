import Dexie from "dexie";
import type { CardPatch, ChildEntity } from "@tccc/shared";
import { isStorableChild, type CasualtyRepo, type ChildInput, type LocalCasualtyCard } from "@/lib/db";
import type { BoardSlice, BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

/** `skipped` lists sections with a row that could not be stored; every other row was written. */
export type CommitResult = { status: "aborted" } | { status: "saved"; clientUpdatedAt: string; skipped: BoardSlice[] };

/** Rows that fail validation are left out and reported, so they do not roll back the rest of the save. */
async function upsertIfStorable<E extends ChildEntity>(
  repo: CasualtyRepo,
  cardId: string,
  entity: E,
  input: ChildInput<E>,
  slice: BoardSlice,
  skipped: Set<BoardSlice>,
): Promise<void> {
  if (!isStorableChild(cardId, entity, input)) {
    skipped.add(slice);
    return;
  }
  await repo.upsertChild(cardId, entity, input);
}

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
  const skipped = new Set<BoardSlice>();
  try {
    const clientUpdatedAt = await repo.readWrite(async () => {
      skipped.clear();
      ensure(isCurrent);
      const card = await requireCard(repo, cardId);
      const fields = changedFields(card, patch);
      if (Object.keys(fields).length > 0) {
        ensure(isCurrent);
        await repo.updateFields(card.id, fields);
      }
      if (dirty.has("body")) {
        ensure(isCurrent);
        await syncInjuries(repo, card, draft, isCurrent, skipped);
        await syncTourniquets(repo, await requireCard(repo, cardId), draft, isCurrent, skipped);
      }
      if (dirty.has("vitals")) {
        ensure(isCurrent);
        await syncVitals(repo, await requireCard(repo, cardId), draft, isCurrent, skipped);
      }
      if (dirty.has("fluids")) {
        ensure(isCurrent);
        await syncFluids(repo, await requireCard(repo, cardId), draft, isCurrent, skipped);
      }
      if (dirty.has("meds")) {
        ensure(isCurrent);
        await syncMeds(repo, await requireCard(repo, cardId), draft, isCurrent, skipped);
      }
      return (await requireCard(repo, cardId)).clientUpdatedAt;
    });
    return { status: "saved", clientUpdatedAt, skipped: [...skipped] };
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

/**
 * A printed target is one row per card, whatever its id; the sheet may create it
 * again after it was cleared. An X placed freely on the figure is its row.
 */
function injuryKey(row: { id: string; siteCode: string | null }): string {
  return row.siteCode ? `site:${row.siteCode}` : `row:${row.id}`;
}

async function syncInjuries(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  draft: BoardSnapshot,
  isCurrent: () => boolean,
  skipped: Set<BoardSlice>,
): Promise<void> {
  const wanted = new Set(draft.injuries.map(injuryKey));
  for (const row of active(card.injurySites)) {
    ensure(isCurrent);
    if (!wanted.has(injuryKey(row))) await repo.deleteChild(card.id, "injurySite", row.id);
  }
  for (const row of draft.injuries) {
    ensure(isCurrent);
    const existing = card.injurySites.find((item) => injuryKey(item) === injuryKey(row));
    const id = existing?.id ?? row.id;
    if (
      existing &&
      !existing.deletedAt &&
      existing.region === row.region &&
      existing.view === row.view &&
      existing.x === row.x &&
      existing.y === row.y &&
      existing.description === row.description
    ) {
      continue;
    }
    await upsertIfStorable(
      repo,
      card.id,
      "injurySite",
      { id, region: row.region, view: row.view, x: row.x, y: row.y, siteCode: row.siteCode, description: row.description },
      "body",
      skipped,
    );
  }
}

async function syncTourniquets(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  draft: BoardSnapshot,
  isCurrent: () => boolean,
  skipped: Set<BoardSlice>,
): Promise<void> {
  const wanted = new Set(draft.tourniquets.map((row) => row.limb));
  for (const row of active(card.tourniquets)) {
    ensure(isCurrent);
    if (!wanted.has(row.limb)) await repo.deleteChild(card.id, "tourniquet", row.id);
  }
  for (const row of draft.tourniquets) {
    ensure(isCurrent);
    const existing = active(card.tourniquets).find((item) => item.limb === row.limb);
    if (existing && existing.type === row.type && existing.appliedAt === row.appliedAt) continue;
    await upsertIfStorable(repo, card.id, "tourniquet", { limb: row.limb, type: row.type, appliedAt: row.appliedAt }, "body", skipped);
  }
}

async function syncVitals(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  draft: BoardSnapshot,
  isCurrent: () => boolean,
  skipped: Set<BoardSlice>,
): Promise<void> {
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
    await upsertIfStorable(
      repo,
      card.id,
      "vitalSigns",
      {
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
      },
      "vitals",
      skipped,
    );
  }
}

async function syncFluids(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  draft: BoardSnapshot,
  isCurrent: () => boolean,
  skipped: Set<BoardSlice>,
): Promise<void> {
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
    const input = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      volumeMl: row.volumeMl,
      route: row.route,
      administeredAt: row.administeredAt,
    } as ChildInput<"fluid">;
    await upsertIfStorable(repo, card.id, "fluid", input, "fluids", skipped);
  }
}

async function syncMeds(
  repo: CasualtyRepo,
  card: LocalCasualtyCard,
  draft: BoardSnapshot,
  isCurrent: () => boolean,
  skipped: Set<BoardSlice>,
): Promise<void> {
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
    const input = {
      id: row.id,
      category: row.category,
      name: row.name,
      dose: row.dose,
      route: row.route,
      administeredAt: row.administeredAt,
    } as ChildInput<"medication">;
    await upsertIfStorable(repo, card.id, "medication", input, "meds", skipped);
  }
}
