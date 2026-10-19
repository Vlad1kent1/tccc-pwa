import { compareHlc, mutationSchema, newId, parseHlc, tourniquetId } from "@tccc/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setServerClockOffset } from "../network-clock";
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

describe("unfinished rows", () => {
  const blankVital = {
    pulseRate: null,
    pulseLocation: null,
    systolic: null,
    diastolic: null,
    respiratoryRate: null,
    spo2: null,
    avpu: null,
    painScale: null,
  };

  it("queues an unfinished row for sync like a finished one", async () => {
    const card = await repo.create();
    const fluid = await repo.upsertChild(card.id, "fluid", {
      kind: "FLUID",
      name: "LR",
      volumeMl: null,
      route: null,
      administeredAt: null,
    });

    const last = await db.outbox.orderBy("seq").last();
    expect(last).toMatchObject({ op: "child.upsert", entity: "fluid", row: { id: fluid.id, name: "LR", volumeMl: null } });
    expect(mutationSchema.safeParse(last).success).toBe(true);
  });

  it("queues the delete of a synced row that was edited into an unfinished state", async () => {
    const card = await repo.create();
    const row = await repo.upsertChild(card.id, "vitalSigns", { ...blankVital, measuredAt: new Date(T0).toISOString(), pulseRate: 90 });
    clock += 1000;
    await repo.upsertChild(card.id, "vitalSigns", { ...blankVital, id: row.id, measuredAt: new Date(T0).toISOString() });
    clock += 1000;
    await repo.deleteChild(card.id, "vitalSigns", row.id);

    const ops = (await db.outbox.orderBy("seq").toArray()).map((entry) => entry.op);
    expect(ops).toEqual(["card.upsert", "child.upsert", "child.upsert", "child.delete"]);
  });

  it("queues rows that never synced before, and their deletions, exactly once", async () => {
    const card = await repo.create();
    await db.outbox.clear();
    const hlcNow = card.clientUpdatedAt;
    const draftFluid = { id: newId(), cardId: card.id, kind: "FLUID" as const, name: "LR", volumeMl: null, route: null, administeredAt: null, clientUpdatedAt: hlcNow, deletedAt: null };
    const deletedDraft = {
      id: newId(),
      cardId: card.id,
      category: "ANALGESIC" as const,
      name: "Ketamine",
      dose: "",
      route: null,
      administeredAt: null,
      clientUpdatedAt: hlcNow,
      deletedAt: new Date(T0).toISOString(),
    };
    const complete = { ...blankVital, id: newId(), cardId: card.id, measuredAt: new Date(T0).toISOString(), pulseRate: 88, clientUpdatedAt: hlcNow, deletedAt: null };
    // As stored before this change: in the card, never in the outbox.
    await db.casualties.put({ ...card, syncStatus: "synced", fluids: [draftFluid], medications: [deletedDraft], vitalSigns: [complete] });
    clock += 1000;

    expect(await repo.queueUnsyncedRows()).toBe(1);

    const outbox = await db.outbox.orderBy("seq").toArray();
    expect(outbox).toEqual([
      expect.objectContaining({ op: "child.upsert", entity: "fluid", row: expect.objectContaining({ id: draftFluid.id }) }),
      expect.objectContaining({ op: "child.delete", entity: "medication", entityId: deletedDraft.id }),
    ]);
    for (const entry of outbox) expect(mutationSchema.safeParse(entry).success).toBe(true);
    const stored = await repo.getById(card.id);
    expect(stored!.syncStatus).toBe("pending");
    expect(stored!.fluids[0]!.clientUpdatedAt).toBe(outbox[0]!.hlc);

    expect(await repo.queueUnsyncedRows()).toBe(0);
    expect(await db.outbox.count()).toBe(2);
  });
});

describe("network-adjusted clock", () => {
  afterEach(() => {
    setServerClockOffset(0);
  });

  it("stamps new writes with the server's time, not a wrong device clock", async () => {
    setServerClockOffset(3_600_000);
    const adjusted = createCasualtyRepo(db);
    const before = Date.now() + 3_600_000;
    const card = await adjusted.create({ lastName: "Hnatiuk" });
    const after = Date.now() + 3_600_000;

    expect(Date.parse(card.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(card.createdAt)).toBeLessThanOrEqual(after);
    expect(parseHlc(card.clientUpdatedAt).wallTime).toBeGreaterThanOrEqual(before);
  });

  it("records a clock for a card deletion", async () => {
    const card = await repo.create();
    clock += 1000;
    await repo.softDelete(card.id);
    const stored = await repo.getById(card.id);
    expect(stored!.fieldClock.deletedAt).toBe(stored!.clientUpdatedAt);
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
