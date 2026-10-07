import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCasualtyRepo, type CasualtyRepo } from "@/lib/db/casualtyRepo";
import { TcccDB } from "@/lib/db/schema";
import { commitBoard } from "@/components/pages/casualties/board/commit";
import { editNotes, getBoard, openSession } from "@/components/pages/casualties/board/store";
import { emptySnapshot } from "@/components/pages/casualties/board/snapshot";

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);

let db: TcccDB;
let repo: CasualtyRepo;

beforeEach(() => {
  db = new TcccDB(`tccc-test-${crypto.randomUUID()}`);
  repo = createCasualtyRepo(db, () => T0);
  openSession(null);
});

afterEach(async () => {
  openSession(null);
  await db.delete();
});

describe("board store", () => {
  it("keeps the injury list reference when notes change", () => {
    const injuries = getBoard().injuries;
    editNotes("under fire");
    expect(getBoard().notes).toBe("under fire");
    expect(getBoard().injuries).toBe(injuries);
  });
});

describe("commitBoard", () => {
  it("rolls back a stale field write", async () => {
    const card = await repo.create({ lastName: "Adler" });
    let checks = 0;
    const draft = emptySnapshot(card.id);
    draft.identity = { ...draft.identity, lastName: "Berg" };
    const outcome = await commitBoard(repo, card.id, draft, new Set(["identity"]), { lastName: "Berg" }, () => ++checks <= 2);
    expect(outcome.status).toBe("aborted");
    expect((await repo.getById(card.id))?.lastName).toBe("Adler");
  });

  it("updates a vital by id", async () => {
    const card = await repo.create({ lastName: "Adler" });
    const vital = await repo.upsertChild(card.id, "vitalSigns", {
      measuredAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
      pulseRate: 60,
      pulseLocation: null,
      systolic: null,
      diastolic: null,
      respiratoryRate: null,
      spo2: null,
      avpu: null,
      painScale: null,
    });
    const draft = emptySnapshot(card.id);
    draft.vitals = [{ ...vital, pulseRate: 111 }];
    const outcome = await commitBoard(repo, card.id, draft, new Set(["vitals"]), {}, () => true);
    expect(outcome.status).toBe("saved");
    const fresh = await repo.getById(card.id);
    const rows = fresh!.vitalSigns.filter((row) => row.deletedAt == null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(vital.id);
    expect(rows[0]?.pulseRate).toBe(111);
  });
});
