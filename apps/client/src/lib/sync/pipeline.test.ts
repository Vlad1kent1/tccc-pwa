import { emptyCardFields, newId, type CasualtyCard } from "@tccc/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastPullSeq, TcccDB, type LocalCasualtyCard, type OutboxMutation } from "@/lib/db";

const pullChanges = vi.hoisted(() => vi.fn());
const pushMutations = vi.hoisted(() => vi.fn());

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    pullChanges: (...args: unknown[]) => pullChanges(...args),
    pushMutations: (...args: unknown[]) => pushMutations(...args),
  };
});

import { pullAll, pushOutbox } from "./pipeline";

const DEVICE = "01999999-9999-7000-8000-000000000099";
const SERVER_TIME = "2026-10-07T09:00:00.000Z";
const ISO = "2026-10-07T08:00:00.000Z";

function hlc(counter: number): string {
  return `1790000000000:${String(counter).padStart(4, "0")}:${DEVICE}`;
}

function serverCard(id: string, clock: number, overrides: Partial<CasualtyCard> = {}): CasualtyCard {
  return {
    id,
    ...emptyCardFields(),
    lastName: "Server",
    injurySites: [],
    tourniquets: [],
    vitalSigns: [],
    fluids: [],
    medications: [],
    fieldClock: { lastName: hlc(clock) },
    version: 4,
    changeSeq: String(clock),
    createdByDeviceId: DEVICE,
    createdAt: ISO,
    serverUpdatedAt: ISO,
    deletedAt: null,
    ...overrides,
  };
}

function localCard(id: string, clock: number, lastName: string): LocalCasualtyCard {
  return {
    id,
    ...emptyCardFields(),
    lastName,
    injurySites: [],
    tourniquets: [],
    vitalSigns: [],
    fluids: [],
    medications: [],
    fieldClock: { lastName: hlc(clock) },
    syncStatus: "pending",
    serverVersion: 3,
    changeSeq: "3",
    createdByDeviceId: DEVICE,
    createdAt: ISO,
    clientUpdatedAt: hlc(clock),
    serverUpdatedAt: ISO,
    deletedAt: null,
    active: 1,
  };
}

function queued(cardId: string, baseVersion: number): OutboxMutation {
  return {
    op: "card.upsert",
    mutationId: newId(),
    cardId,
    hlc: hlc(8),
    baseVersion,
    patch: { notes: "still-local" },
    changedFields: ["notes"],
    status: "queued",
    attempts: 0,
    createdAt: 1,
  };
}

function page(cards: CasualtyCard[], nextSince: string, hasMore: boolean) {
  return { cards, nextSince, hasMore, serverTime: SERVER_TIME };
}

let db: TcccDB;

beforeEach(() => {
  db = new TcccDB(`tccc-pull-${crypto.randomUUID()}`);
  pullChanges.mockReset();
  pushMutations.mockReset();
});

afterEach(async () => {
  await db.delete();
});

describe("pullAll", () => {
  it("replays queued edits and advances their base version in one write", async () => {
    const id = newId();
    await db.casualties.put(localCard(id, 1, "Local"));
    await db.outbox.add(queued(id, 3));
    pullChanges.mockResolvedValue(page([serverCard(id, 5, { version: 6 })], "6", false));

    await pullAll(db);

    const stored = await db.casualties.get(id);
    expect(stored).toMatchObject({ lastName: "Server", notes: "still-local", serverVersion: 6, syncStatus: "pending", active: 1 });
    expect((await db.outbox.toArray())[0]).toMatchObject({ baseVersion: 6, status: "queued" });
    expect(await getLastPullSeq(db)).toBe("6");
  });

  it("ignores a pull whose clock is older than the stored card", async () => {
    const id = newId();
    await db.casualties.put(localCard(id, 9, "Local"));
    await db.outbox.add(queued(id, 3));
    pullChanges.mockResolvedValue(page([serverCard(id, 2, { version: 8, lastName: "Stale" })], "8", false));

    await pullAll(db);

    expect(await db.casualties.get(id)).toMatchObject({ lastName: "Local", clientUpdatedAt: hlc(9) });
    expect((await db.outbox.toArray())[0]?.baseVersion).toBe(3);
  });

  it("rolls back the card write when the outbox update fails", async () => {
    const id = newId();
    await db.casualties.put(localCard(id, 1, "Local"));
    await db.outbox.add(queued(id, 3));
    pullChanges.mockResolvedValue(page([serverCard(id, 5)], "5", false));
    db.outbox.hook("updating", (mods) => {
      if ("baseVersion" in mods) throw new Error("outbox failed");
    });

    await expect(pullAll(db)).rejects.toThrow("outbox failed");
    expect(await db.casualties.get(id)).toMatchObject({ lastName: "Local", serverVersion: 3 });
    expect((await db.outbox.toArray())[0]?.baseVersion).toBe(3);
    expect(await getLastPullSeq(db)).toBe("0");
  });

  it("applies every card across pages, including a chunk boundary", async () => {
    const first = Array.from({ length: 21 }, (_, index) => serverCard(newId(), index + 1));
    const extra = serverCard(newId(), 40);
    pullChanges.mockImplementation(async (since: string) => {
      if (since === "0") return page(first, "21", true);
      if (since === "21") return page([extra], "22", false);
      throw new Error(`unexpected cursor ${since}`);
    });

    await pullAll(db);

    expect(await db.casualties.where("active").equals(1).count()).toBe(22);
    expect(await db.casualties.get(extra.id)).toMatchObject({ lastName: "Server" });
    expect(await getLastPullSeq(db)).toBe("22");
  });
});

describe("pushOutbox", () => {
  it("keeps the mutation when writing the applied card fails", async () => {
    const id = newId();
    const mutationId = newId();
    await db.outbox.add({ ...queued(id, 1), mutationId, baseVersion: null });
    pushMutations.mockResolvedValue({
      serverTime: SERVER_TIME,
      results: [{ mutationId, status: "applied", card: serverCard(id, 4) }],
    });
    db.casualties.hook("creating", () => {
      throw new Error("disk full");
    });

    await expect(pushOutbox(db)).rejects.toThrow("disk full");
    expect(await db.casualties.count()).toBe(0);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]).toMatchObject({ mutationId, status: "inflight" });
  });
});
