import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CirculationTreatment, emptyCardFields, initialHlc, mutationSchema, newId } from "@tccc/shared";
import { createCasualtyRepo } from "./casualtyRepo";
import { LEGACY_BAG_KEY, finishLegacyExtrasMigration } from "./legacy-extras";
import { TcccDB } from "./schema";

const openDatabases: Dexie[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.delete()));
  vi.unstubAllGlobals();
});

const V2_STORES = {
  casualties: "id, evacPriority, syncStatus, clientUpdatedAt, deletedAt, active, battleRosterNumber, [lastName+firstName]",
  outbox: "++seq, &mutationId, cardId, status, createdAt",
  conflicts: "id, cardId, resolvedAt, open, [cardId+open]",
  meta: "key",
};

const PAPER_FIELDS = [
  "casualtyLast4",
  "service",
  "unit",
  "tqExtremity",
  "tqJunctional",
  "tqTruncal",
  "dressingOtherType",
  "circulationTqType",
  "circulationDressingType",
  "airwayType",
  "breathingType",
  "combatPillPack",
  "eyeShieldRight",
  "eyeShieldLeft",
  "hypothermiaType",
  "rowDrafts",
];

/** A card as a v2 client stored it: no paper fields, maybe a `paperExtras` bag. */
function v2Card(id: string, extra: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = emptyCardFields();
  for (const field of PAPER_FIELDS) delete fields[field];
  return {
    id,
    ...fields,
    injurySites: [],
    tourniquets: [],
    vitalSigns: [],
    fluids: [],
    medications: [],
    fieldClock: {},
    syncStatus: "synced",
    serverVersion: 3,
    changeSeq: "7",
    createdByDeviceId: DEVICE,
    createdAt: "2026-10-01T08:00:00.000Z",
    clientUpdatedAt: "1790000000000:0000:device",
    serverUpdatedAt: "2026-10-01T08:00:00.000Z",
    deletedAt: null,
    active: 1,
    ...extra,
  };
}

const DEVICE = newId();

function memoryStorage(initial: Record<string, string>): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

async function seedV2(cards: ReturnType<typeof v2Card>[]): Promise<string> {
  const name = `tccc-migrate-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  openDatabases.push(legacy);
  legacy.version(2).stores(V2_STORES);
  await legacy.table("casualties").bulkAdd(cards);
  await legacy.table("meta").bulkAdd([
    { key: "deviceId", value: DEVICE },
    { key: "hlcState", value: initialHlc(DEVICE) },
  ]);
  legacy.close();
  return name;
}

describe("Dexie version 2", () => {
  it("backfills active and open so the new indexes can find existing rows", async () => {
    const name = `tccc-migrate-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    openDatabases.push(legacy);
    legacy.version(1).stores({
      casualties: "id, evacPriority, syncStatus, clientUpdatedAt, deletedAt, battleRosterNumber, [lastName+firstName]",
      outbox: "++seq, &mutationId, cardId, status, createdAt",
      conflicts: "id, cardId, resolvedAt",
      meta: "key",
    });
    await legacy.table("casualties").bulkAdd([
      { id: "live", deletedAt: null, lastName: "Live" },
      { id: "gone", deletedAt: "2026-01-01T00:00:00.000Z", lastName: "Gone" },
    ]);
    await legacy.table("conflicts").bulkAdd([
      { id: "open-row", cardId: "live", resolvedAt: null },
      { id: "closed-row", cardId: "live", resolvedAt: "2026-01-02T00:00:00.000Z" },
    ]);
    legacy.close();

    const upgraded = new TcccDB(name);
    openDatabases.push(upgraded);
    expect(await upgraded.casualties.where("active").equals(1).primaryKeys()).toEqual(["live"]);
    expect(await upgraded.casualties.get("gone")).toMatchObject({ active: 0 });
    expect(await upgraded.conflicts.where("open").equals(1).primaryKeys()).toEqual(["open-row"]);
    expect(await upgraded.conflicts.where("[cardId+open]").equals(["live", 1]).primaryKeys()).toEqual(["open-row"]);
    expect(await upgraded.conflicts.get("closed-row")).toMatchObject({ open: 0 });
  });
});

describe("Dexie version 3", () => {
  it("moves paper extras and the localStorage bag into card fields and queues them for sync", async () => {
    const alpha = newId();
    const bravo = newId();
    const gone = newId();
    const name = await seedV2([
      v2Card(alpha, {
        circulation: [CirculationTreatment.TOURNIQUET],
        paperExtras: {
          unit: "1 BN",
          tqTruncal: true,
          treatmentTypeA: "NPA 28Fr",
          dressingOther: "Israeli",
          fieldDrafts: { row1: { time: "14" } },
        },
      }),
      v2Card(bravo, { circulation: [CirculationTreatment.TOURNIQUET] }),
      v2Card(gone, { deletedAt: "2026-10-02T00:00:00.000Z", active: 0, paperExtras: { service: "Army" } }),
    ]);
    const bag = { [alpha]: { last4: "0427", unit: "", eyeLeft: true }, draft: { unit: "never created" } };
    const storage = memoryStorage({ [LEGACY_BAG_KEY]: JSON.stringify(bag) });
    vi.stubGlobal("localStorage", storage);

    const db = new TcccDB(name);
    openDatabases.push(db);
    const card = await db.casualties.get(alpha);
    expect(card).toMatchObject({
      casualtyLast4: "0427",
      unit: "1 BN",
      tqTruncal: true,
      tqExtremity: false,
      airwayType: "NPA 28Fr",
      dressingOtherType: "Israeli",
      eyeShieldLeft: true,
      combatPillPack: false,
      service: null,
      rowDrafts: { row1: { time: "14" } },
      syncStatus: "pending",
    });
    expect(card).not.toHaveProperty("paperExtras");
    expect(card!.fieldClock.unit).toBe(card!.clientUpdatedAt);

    const queued = await db.outbox.toArray();
    const alphaPush = queued.find((entry) => entry.cardId === alpha);
    expect(mutationSchema.safeParse(alphaPush).success).toBe(true);
    expect(alphaPush).toMatchObject({ op: "card.upsert", baseVersion: 3, patch: { casualtyLast4: "0427", tqTruncal: true } });
    expect(await db.casualties.get(bravo)).toMatchObject({ tqExtremity: true, rowDrafts: {} });
    expect(queued.some((entry) => entry.cardId === gone)).toBe(false);
    expect(await db.casualties.get(gone)).toMatchObject({ service: "Army" });

    // The upgrade merged the bag, so finishing only removes it.
    await finishLegacyExtrasMigration(db, createCasualtyRepo(db).updateFields);
    expect(storage.getItem(LEGACY_BAG_KEY)).toBeNull();
    expect(await db.outbox.count()).toBe(queued.length);
  });

  it("merges the bag after opening when the upgrade ran without localStorage", async () => {
    const alpha = newId();
    const name = await seedV2([v2Card(alpha, { paperExtras: { unit: "1 BN" } })]);

    const db = new TcccDB(name);
    openDatabases.push(db);
    expect(await db.casualties.get(alpha)).toMatchObject({ unit: "1 BN", casualtyLast4: null });

    const storage = memoryStorage({ [LEGACY_BAG_KEY]: JSON.stringify({ [alpha]: { last4: "0427", unit: "2 BN" } }) });
    vi.stubGlobal("localStorage", storage);
    await finishLegacyExtrasMigration(db, createCasualtyRepo(db).updateFields);

    // Fields already set by the upgrade keep their value; empty ones are filled and queued.
    expect(await db.casualties.get(alpha)).toMatchObject({ unit: "1 BN", casualtyLast4: "0427" });
    const pushes = (await db.outbox.toArray()).filter((entry) => entry.op === "card.upsert");
    expect(pushes.some((entry) => entry.op === "card.upsert" && entry.changedFields.includes("casualtyLast4"))).toBe(true);
    expect(storage.getItem(LEGACY_BAG_KEY)).toBeNull();
  });
});

describe("Dexie version 4", () => {
  function injury(id: string, description: string | null) {
    return { id, cardId: "c", region: "CHEST", view: "FRONT", x: 0.4, y: 0.3, description, clientUpdatedAt: "1790000000000:0000:device", deletedAt: null };
  }

  it("keeps only the active index and moves the printed injury target out of the description", async () => {
    const markId = newId();
    const card = v2Card("c", {
      injurySites: [injury("site", "Ant_Right_Shoulder"), injury(markId, `mark:${markId}`), injury("text", "shrapnel, left flank")],
    });
    const name = await seedV2([card]);
    const legacy = new Dexie(name);
    openDatabases.push(legacy);
    legacy.version(3).stores(V2_STORES);
    await legacy.table("outbox").add({
      op: "child.upsert",
      entity: "injurySite",
      row: injury("queued", "Post_Left_Shoulder"),
      mutationId: newId(),
      cardId: "c",
      hlc: "1790000000000:0001:device",
      baseVersion: 3,
      status: "queued",
      attempts: 0,
      createdAt: 1,
    });
    await legacy.table("conflicts").add({ id: "conflict", cardId: "c", entity: "injurySite", field: "row", kept: injury("site", "Ant_Right_Shoulder"), discarded: null, open: 1 });
    legacy.close();

    const upgraded = new TcccDB(name);
    openDatabases.push(upgraded);
    await upgraded.open();

    expect(upgraded.casualties.schema.indexes.map((index) => index.name)).toEqual(["active"]);
    const sites = (await upgraded.casualties.get("c"))!.injurySites;
    expect(sites.map(({ id, siteCode, description }) => ({ id, siteCode, description }))).toEqual([
      { id: "site", siteCode: "Ant_Right_Shoulder", description: null },
      { id: markId, siteCode: null, description: null },
      { id: "text", siteCode: null, description: "shrapnel, left flank" },
    ]);
    const [queued] = await upgraded.outbox.toArray();
    expect(queued).toMatchObject({ row: { siteCode: "Post_Left_Shoulder", description: null } });
    expect((await upgraded.conflicts.get("conflict"))?.kept).toMatchObject({ siteCode: "Ant_Right_Shoulder", description: null });
  });
});
