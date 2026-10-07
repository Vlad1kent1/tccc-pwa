import { newId } from "@tccc/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCasualtyRepo, type CasualtyRepo } from "@/lib/db/casualtyRepo";
import { TcccDB } from "@/lib/db/schema";
import { cardToValues, vitalSlotKey } from "@/components/pages/casualties/dd1380/mapping";
import { persistForm } from "@/components/pages/casualties/dd1380/persist-form";
import { sheetReaction } from "@/components/pages/casualties/dd1380/use-bound-form";

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);

let db: TcccDB;
let repo: CasualtyRepo;
let clock: number;

beforeEach(() => {
  db = new TcccDB(`tccc-test-${crypto.randomUUID()}`);
  clock = T0;
  repo = createCasualtyRepo(db, () => clock);
});

afterEach(async () => {
  await db.delete();
});

describe("persistForm", () => {
  it("keeps a vital row on its id when that column's time moves past another row", async () => {
    const card = await repo.create({ lastName: "Adler" });
    const early = new Date(2026, 9, 1, 8, 0, 0).toISOString();
    const later = new Date(2026, 9, 1, 9, 0, 0).toISOString();
    const first = await repo.upsertChild(card.id, "vitalSigns", emptyVital(early, 60));
    const second = await repo.upsertChild(card.id, "vitalSigns", emptyVital(later, 80));
    const stored = await repo.getById(card.id);
    const values: Record<string, string | boolean> = { ...cardToValues(stored!) };
    expect(values[vitalSlotKey(1)]).toBe(first.id);
    expect(values[vitalSlotKey(2)]).toBe(second.id);

    values.time1 = "1000";
    values.pulse1 = "111";
    const outcome = await persistForm(repo, card.id, values, () => true);
    expect(outcome.status).toBe("saved");

    const fresh = await repo.getById(card.id);
    const rows = fresh!.vitalSigns.filter((row) => row.deletedAt == null);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first.id)?.pulseRate).toBe(111);
    expect(rows.find((row) => row.id === second.id)?.pulseRate).toBe(80);
  });

  it("rolls back the whole commit when a newer edit starts mid-save", async () => {
    const card = await repo.create({ lastName: "Adler" });
    let checks = 0;
    const values: Record<string, string | boolean> = { ...cardToValues(card), name: "Berg" };
    const outcome = await persistForm(repo, card.id, values, () => ++checks <= 2);
    expect(outcome.status).toBe("aborted");
    expect((await repo.getById(card.id))?.lastName).toBe("Adler");
  });

  it("does not write when the generation is already stale", async () => {
    const card = await repo.create({ lastName: "Adler" });
    const values: Record<string, string | boolean> = { ...cardToValues(card), notes: "late" };
    const outcome = await persistForm(repo, card.id, values, () => false);
    expect(outcome.status).toBe("aborted");
    expect((await repo.getById(card.id))?.notes).toBeNull();
  });
});

describe("sheetReaction", () => {
  it("replaces a clean sheet and holds a dirty one", () => {
    expect(sheetReaction({ cardUpdatedAt: "new", acked: "old", basedOn: "old", dirty: false })).toBe("adopt");
    expect(sheetReaction({ cardUpdatedAt: "new", acked: "old", basedOn: "old", dirty: true })).toBe("conflict");
    expect(sheetReaction({ cardUpdatedAt: "mine", acked: "mine", basedOn: "old", dirty: true })).toBe("ignore");
    expect(sheetReaction({ cardUpdatedAt: "held", acked: "old", basedOn: "held", dirty: true })).toBe("ignore");
  });
});

function emptyVital(measuredAt: string, pulseRate: number) {
  return {
    id: newId(),
    measuredAt,
    pulseRate,
    pulseLocation: null,
    systolic: null,
    diastolic: null,
    respiratoryRate: null,
    spo2: null,
    avpu: null,
    painScale: null,
  };
}
