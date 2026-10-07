import { compareHlc, mutationSchema, tourniquetId } from "@tccc/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CardNotFoundError, createCasualtyRepo, type CasualtyRepo } from "./casualtyRepo";
import { getDeviceId } from "./meta";
import { TcccDB } from "./schema";

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

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

describe("create", () => {
  it("writes the card and exactly one valid outbox mutation", async () => {
    const card = await repo.create({ lastName: "  Kovalenko ", evacPriority: "URGENT" });

    expect(card.lastName).toBe("Kovalenko");
    expect(card.syncStatus).toBe("pending");
    expect(card.serverVersion).toBeNull();
    expect(card.createdByDeviceId).toBe(await getDeviceId(db));

    const outbox = await db.outbox.toArray();
    expect(outbox).toHaveLength(1);
    const [entry] = outbox;
    expect(entry).toMatchObject({ op: "card.upsert", cardId: card.id, status: "queued", attempts: 0, baseVersion: null });
    expect(mutationSchema.safeParse(entry).success).toBe(true);
    expect(entry!.hlc).toBe(card.clientUpdatedAt);
    expect(new Set(Object.values(card.fieldClock))).toEqual(new Set([card.clientUpdatedAt]));
  });

  it("writes nothing when any part of the transaction fails", async () => {
    db.outbox.hook("creating", () => {
      throw new Error("simulated outbox failure");
    });

    await expect(repo.create({ lastName: "Melnyk" })).rejects.toThrow("simulated outbox failure");
    expect(await db.casualties.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("rejects invalid input before touching the database", async () => {
    await expect(repo.create({ responderLast4: "12a4" })).rejects.toThrow();
    expect(await db.casualties.count()).toBe(0);
  });
});

describe("updateFields", () => {
  it("stamps only the changed fields and queues a minimal patch", async () => {
    const card = await repo.create({ lastName: "Boiko", allergies: "NKA" });
    clock += 1000;

    const updated = await repo.updateFields(card.id, { allergies: "Penicillin", lastName: "Boiko" });

    expect(updated.allergies).toBe("Penicillin");
    expect(compareHlc(updated.fieldClock.allergies!, card.fieldClock.allergies!)).toBe(1);
    expect(updated.fieldClock.lastName).toBe(card.fieldClock.lastName);

    const last = await db.outbox.orderBy("seq").last();
    expect(last).toMatchObject({ op: "card.upsert", patch: { allergies: "Penicillin" }, changedFields: ["allergies"] });
  });

  it("does not queue anything when nothing changed", async () => {
    const card = await repo.create({ lastName: "Moroz" });
    await repo.updateFields(card.id, { lastName: "Moroz" });
    expect(await db.outbox.count()).toBe(1);
  });

  it("keeps HLCs monotonic even if the wall clock goes backwards", async () => {
    const card = await repo.create();
    clock -= 60_000;
    const updated = await repo.updateFields(card.id, { notes: "Clock skew" });
    expect(compareHlc(updated.clientUpdatedAt, card.clientUpdatedAt)).toBe(1);
  });
});

describe("child rows", () => {
  it("gives a tourniquet a deterministic id and replaces it on the same limb", async () => {
    const card = await repo.create();
    const first = await repo.upsertChild(card.id, "tourniquet", {
      limb: "LEFT_LEG",
      type: "CAT",
      appliedAt: new Date(T0).toISOString(),
    });
    expect(first.id).toBe(tourniquetId(card.id, "LEFT_LEG"));

    await repo.upsertChild(card.id, "tourniquet", {
      limb: "LEFT_LEG",
      type: "SOFTT-W",
      appliedAt: new Date(T0 + 60_000).toISOString(),
    });

    const stored = await repo.getById(card.id);
    expect(stored!.tourniquets).toHaveLength(1);
    expect(stored!.tourniquets[0]!.type).toBe("SOFTT-W");
  });

  it("validates child rows with the shared schema", async () => {
    const card = await repo.create();
    await expect(
      repo.upsertChild(card.id, "vitalSigns", {
        measuredAt: new Date(T0).toISOString(),
        pulseRate: null,
        pulseLocation: null,
        systolic: 80,
        diastolic: 120,
        respiratoryRate: null,
        spo2: null,
        avpu: null,
        painScale: null,
      }),
    ).rejects.toThrow();
    expect(await db.outbox.count()).toBe(1);
  });

  it("tombstones a deleted child instead of removing it", async () => {
    const card = await repo.create();
    const med = await repo.upsertChild(card.id, "medication", {
      category: "ANALGESIC",
      name: "Ketamine",
      dose: "50 mg",
      route: "IM",
      administeredAt: new Date(T0).toISOString(),
    });
    clock += 5000;
    await repo.deleteChild(card.id, "medication", med.id);

    const stored = await repo.getById(card.id);
    expect(stored!.medications).toHaveLength(1);
    expect(stored!.medications[0]!.deletedAt).toBe(new Date(clock).toISOString());

    const last = await db.outbox.orderBy("seq").last();
    expect(last).toMatchObject({ op: "child.delete", entity: "medication", entityId: med.id });
  });
});

describe("softDelete and listActive", () => {
  it("hides deleted cards from the active list and blocks further edits", async () => {
    const kept = await repo.create({ lastName: "Lysenko" });
    const removed = await repo.create({ lastName: "Oliinyk" });

    await repo.softDelete(removed.id);

    const active = await repo.listActive();
    expect(active.map((c) => c.id)).toEqual([kept.id]);
    expect(kept.active).toBe(1);
    expect((await repo.getById(removed.id))!.active).toBe(0);
    expect((await repo.getById(removed.id))!.deletedAt).not.toBeNull();
    await expect(repo.updateFields(removed.id, { notes: "late edit" })).rejects.toBeInstanceOf(CardNotFoundError);

    const ops = (await db.outbox.orderBy("seq").toArray()).map((m) => m.op);
    expect(ops).toEqual(["card.upsert", "card.upsert", "card.delete"]);
  });
});
