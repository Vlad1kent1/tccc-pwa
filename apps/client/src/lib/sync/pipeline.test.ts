import { compareHlc, emptyCardFields, formatHlc, newId, parseHlc, type CasualtyCard, type Mutation } from "@tccc/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCasualtyRepo, getLastPullSeq, getMeta, TcccDB, type LocalCasualtyCard, type OutboxMutation } from "@/lib/db";
import { getServerClockOffset, setServerClockOffset } from "@/lib/network-clock";

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

import { ApiError } from "./api";
import { chunkMutations, jsonBytes, MAX_PUSH_BYTES, MAX_PUSH_MUTATIONS, pullAll, pushOutbox } from "./pipeline";

const DEVICE = "01999999-9999-7000-8000-000000000099";
const OTHER = "01999999-9999-7000-8000-0000000000bb";
const SERVER_TIME = "2026-10-07T09:00:00.000Z";
const ISO = "2026-10-07T08:00:00.000Z";

function hlc(counter: number, node = DEVICE): string {
  return `1790000000000:${String(counter).padStart(4, "0")}:${node}`;
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

function queued(cardId: string, baseVersion: number | null, patch: Record<string, unknown> = { notes: "still-local" }): OutboxMutation {
  return {
    op: "card.upsert",
    mutationId: newId(),
    cardId,
    hlc: hlc(8),
    baseVersion,
    patch,
    changedFields: Object.keys(patch),
    status: "queued",
    attempts: 0,
    createdAt: 1,
  } as OutboxMutation;
}

function vital(cardId: string, id: string, pulseRate: number, clock: string, deletedAt: string | null = null) {
  return {
    id,
    cardId,
    measuredAt: ISO,
    pulseRate,
    pulseLocation: null,
    systolic: null,
    diastolic: null,
    respiratoryRate: null,
    spo2: null,
    avpu: null,
    painScale: null,
    clientUpdatedAt: clock,
    deletedAt,
  };
}

function page(cards: CasualtyCard[], nextSince: string, hasMore: boolean) {
  return { cards, nextSince, hasMore, serverTime: SERVER_TIME };
}

/** A server that applies every mutation it receives. */
function applyAll(_deviceId: string, mutations: Mutation[]) {
  return Promise.resolve({
    serverTime: SERVER_TIME,
    results: mutations.map((mutation) => ({
      mutationId: mutation.mutationId,
      status: "applied" as const,
      card: serverCard(mutation.cardId, 5, { version: 5 }),
    })),
  });
}

let db: TcccDB;

beforeEach(() => {
  db = new TcccDB(`tccc-pull-${crypto.randomUUID()}`);
  pullChanges.mockReset();
  pushMutations.mockReset();
  setServerClockOffset(0);
});

afterEach(async () => {
  setServerClockOffset(0);
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

  it("merges another device's edits into a card this device edited more recently", async () => {
    const id = newId();
    const rowId = newId();
    await db.casualties.put(localCard(id, 9, "Local"));
    // The other device's clock is behind ours: its edits are older than our latest one.
    const fromOther = serverCard(id, 2, {
      lastName: "Stale",
      allergies: "Penicillin",
      fieldClock: { lastName: hlc(2, OTHER), allergies: hlc(5, OTHER) },
      vitalSigns: [vital(id, rowId, 112, hlc(4, OTHER))],
      version: 8,
    });
    pullChanges.mockResolvedValue(page([fromOther], "8", false));

    await pullAll(db);

    const stored = await db.casualties.get(id);
    expect(stored).toMatchObject({ lastName: "Local", allergies: "Penicillin", serverVersion: 8, syncStatus: "synced" });
    expect(stored!.vitalSigns).toEqual([expect.objectContaining({ id: rowId, pulseRate: 112 })]);
    // Re-stamped, so an open board and the list see the remote change as the newest.
    expect(compareHlc(stored!.clientUpdatedAt, hlc(9))).toBeGreaterThan(0);
    expect(await getLastPullSeq(db)).toBe("8");
  });

  it("writes nothing for a pulled card that brings no change", async () => {
    const id = newId();
    pullChanges.mockResolvedValueOnce(page([serverCard(id, 5)], "5", false));
    await pullAll(db);
    const first = await db.casualties.get(id);

    let writes = 0;
    db.casualties.hook("updating", () => {
      writes += 1;
    });
    pullChanges.mockResolvedValueOnce(page([serverCard(id, 5)], "6", false));
    await pullAll(db);

    expect(writes).toBe(0);
    expect((await db.casualties.get(id))?.clientUpdatedAt).toBe(first?.clientUpdatedAt);
  });

  it("makes the next local edit newer than every clock it pulled", async () => {
    const id = newId();
    const ahead = formatHlc({ wallTime: 1_800_000_000_000, counter: 3, nodeId: OTHER });
    pullChanges.mockResolvedValue(page([serverCard(id, 5, { fieldClock: { lastName: ahead } })], "5", false));

    await pullAll(db);
    const repo = createCasualtyRepo(db, () => 1_790_000_000_000);
    const edited = await repo.updateFields(id, { lastName: "Mine" });

    expect(compareHlc(edited.fieldClock.lastName!, ahead)).toBeGreaterThan(0);
    expect(parseHlc(edited.fieldClock.lastName!).wallTime).toBe(1_800_000_000_000);
  });

  it("does not move the server version back for an older snapshot", async () => {
    const id = newId();
    await db.casualties.put({ ...localCard(id, 9, "Local"), serverVersion: 9 });
    await db.outbox.add(queued(id, 9));
    pullChanges.mockResolvedValue(page([serverCard(id, 2, { version: 7 })], "7", false));

    await pullAll(db);

    expect(await db.casualties.get(id)).toMatchObject({ lastName: "Local", serverVersion: 9 });
    expect((await db.outbox.toArray())[0]?.baseVersion).toBe(9);
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

  it("puts the batch back in the queue, uncounted, when the unit token is refused", async () => {
    const id = newId();
    const mutationId = newId();
    await db.outbox.add({ ...queued(id, 1), mutationId, baseVersion: null });
    pushMutations.mockRejectedValue(new ApiError(401, "POST /api/sync/push failed (401)"));

    await expect(pushOutbox(db)).rejects.toMatchObject({ status: 401 });
    expect(await db.outbox.toArray()).toMatchObject([{ mutationId, status: "queued", attempts: 0 }]);
  });

  it("records the server clock offset from each response", async () => {
    const id = newId();
    await db.outbox.add(queued(id, null));
    const serverTime = new Date(Date.now() + 3_600_000).toISOString();
    pushMutations.mockImplementation(async (deviceId: string, mutations: Mutation[]) => ({
      ...(await applyAll(deviceId, mutations)),
      serverTime,
    }));

    await pushOutbox(db);

    expect(getServerClockOffset()).toBeGreaterThan(3_590_000);
    expect(getServerClockOffset()).toBeLessThan(3_610_000);
    expect(await getMeta(db, "serverClockOffsetMs")).toBe(getServerClockOffset());
  });
});

describe("deletes the server no longer has", () => {
  async function pushRejected(mutation: OutboxMutation, code: "NOT_FOUND" | "VALIDATION") {
    await db.outbox.add(mutation);
    pushMutations.mockResolvedValue({
      serverTime: SERVER_TIME,
      results: [{ mutationId: mutation.mutationId, status: "rejected", error: { code, message: "gone" } }],
    });
    return pushOutbox(db);
  }

  it("clears a row deletion answered NOT_FOUND and marks the card synced", async () => {
    const id = newId();
    const rowId = newId();
    await db.casualties.put({ ...localCard(id, 4, "Local"), vitalSigns: [vital(id, rowId, 90, hlc(4), ISO)] });

    const outcome = await pushRejected(
      {
        op: "child.delete",
        entity: "vitalSigns",
        entityId: rowId,
        deletedAt: ISO,
        mutationId: newId(),
        cardId: id,
        hlc: hlc(4),
        baseVersion: 3,
        status: "queued",
        attempts: 0,
        createdAt: 1,
      },
      "NOT_FOUND",
    );

    expect(outcome).toBe("ok");
    expect(await db.outbox.count()).toBe(0);
    expect((await db.casualties.get(id))?.syncStatus).toBe("synced");
  });

  it("clears a card deletion answered NOT_FOUND", async () => {
    const id = newId();
    await db.casualties.put({ ...localCard(id, 4, "Local"), deletedAt: ISO, active: 0 });
    await pushRejected(
      { op: "card.delete", deletedAt: ISO, mutationId: newId(), cardId: id, hlc: hlc(4), baseVersion: null, status: "queued", attempts: 0, createdAt: 1 },
      "NOT_FOUND",
    );
    expect(await db.outbox.count()).toBe(0);
  });

  it("still fails an upsert answered NOT_FOUND, and any rejected delete that is not NOT_FOUND", async () => {
    const id = newId();
    await db.casualties.put(localCard(id, 4, "Local"));
    await pushRejected(queued(id, 3), "NOT_FOUND");
    expect(await db.outbox.toArray()).toEqual([expect.objectContaining({ status: "failed" })]);

    await db.outbox.clear();
    await pushRejected(
      {
        op: "child.delete",
        entity: "vitalSigns",
        entityId: newId(),
        deletedAt: ISO,
        mutationId: newId(),
        cardId: id,
        hlc: hlc(5),
        baseVersion: 3,
        status: "queued",
        attempts: 0,
        createdAt: 2,
      },
      "VALIDATION",
    );
    expect(await db.outbox.toArray()).toEqual([expect.objectContaining({ status: "failed" })]);
  });
});

describe("mutations the server could not apply", () => {
  it("keeps an INTERNAL rejection queued for a later push and applies the rest", async () => {
    const failing = queued(newId(), null);
    const fine = queued(newId(), null);
    await db.outbox.bulkAdd([failing, fine]);
    const internal = { code: "INTERNAL", message: "Server could not apply the mutation" };
    pushMutations.mockImplementation(async (deviceId: string, mutations: Mutation[]) => {
      const response = await applyAll(deviceId, mutations);
      const results = response.results.map((result) =>
        result.mutationId === failing.mutationId ? { mutationId: result.mutationId, status: "rejected", error: internal } : result,
      );
      return { ...response, results };
    });
    const onRetry = vi.fn();

    expect(await pushOutbox(db, onRetry)).toBe("partial");

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({
        mutationId: failing.mutationId,
        status: "queued",
        attempts: 1,
        lastError: "INTERNAL: Server could not apply the mutation",
      }),
    ]);
    expect(onRetry).toHaveBeenCalledWith({ attempts: 1, message: "INTERNAL: Server could not apply the mutation" });

    // Once the server can apply it, the next push sends it and the outbox drains.
    pushMutations.mockImplementation(applyAll);
    expect(await pushOutbox(db)).toBe("ok");
    expect(sentIds(pushMutations.mock.calls.at(-1))).toEqual([failing.mutationId]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("passes the HTTP status of a failed request to onRetry", async () => {
    await db.outbox.add(queued(newId(), null));
    pushMutations.mockRejectedValue(new ApiError(503, "POST /api/sync/push failed (503)"));
    const onRetry = vi.fn();

    expect(await pushOutbox(db, onRetry)).toBe("retry");
    expect(onRetry).toHaveBeenCalledWith({ attempts: 1, message: "POST /api/sync/push failed (503)", status: 503 });
    expect(await db.outbox.toArray()).toEqual([expect.objectContaining({ status: "queued", attempts: 1 })]);
  });
});

function sentIds(call: unknown[] | undefined): string[] {
  return ((call?.[1] ?? []) as Mutation[]).map((mutation) => mutation.mutationId);
}

describe("chunkMutations", () => {
  it("caps each request by count and by bytes, in order", () => {
    const sizes = [10, 10, 10, 10, 10];
    const batches = chunkMutations(sizes.map((size, index) => ({ index, size })), (entry) => entry.size, { maxCount: 2, maxBytes: 25 });
    expect(batches.map((batch) => batch.map((entry) => entry.index))).toEqual([[0, 1], [2, 3], [4]]);

    const bySize = chunkMutations([10, 10, 10].map((size, index) => ({ index, size })), (entry) => entry.size, { maxCount: 10, maxBytes: 25 });
    expect(bySize.map((batch) => batch.length)).toEqual([2, 1]);
  });

  it("sends a mutation larger than the byte cap on its own", () => {
    const batches = chunkMutations([5, 100, 5].map((size, index) => ({ index, size })), (entry) => entry.size, { maxCount: 10, maxBytes: 20 });
    expect(batches.map((batch) => batch.map((entry) => entry.index))).toEqual([[0], [1], [2]]);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(jsonBytes("жгут")).toBe(10);
  });
});

describe("pushing a mass-casualty backlog", () => {
  async function queueCards(count: number, notes = "") {
    for (let index = 0; index < count; index += 1) {
      await db.outbox.add({ ...queued(newId(), null, notes ? { notes } : { lastName: `C-${index}` }), createdAt: index });
    }
  }

  function sentBatches(): Mutation[][] {
    return pushMutations.mock.calls.map((call) => call[1] as Mutation[]);
  }

  it(`sends at most ${MAX_PUSH_MUTATIONS} mutations per request`, async () => {
    await queueCards(120);
    pushMutations.mockImplementation(applyAll);

    expect(await pushOutbox(db)).toBe("ok");

    expect(sentBatches().map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(await db.outbox.count()).toBe(0);
  });

  it(`keeps every request under ${MAX_PUSH_BYTES} bytes of mutations`, async () => {
    // Cyrillic notes take two bytes a character: 4,000 characters is about 8 kB each.
    await queueCards(20, "ж".repeat(4000));
    pushMutations.mockImplementation(applyAll);

    await pushOutbox(db);

    const batches = sentBatches();
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(jsonBytes(batch)).toBeLessThanOrEqual(MAX_PUSH_BYTES + batch.length + 2);
    expect(batches.flat()).toHaveLength(20);
  });

  it("halves a request the server refuses as too large, keeping the order", async () => {
    await queueCards(8);
    pushMutations.mockImplementation((deviceId: string, mutations: Mutation[]) =>
      mutations.length > 2 ? Promise.reject(new ApiError(413, "POST /api/sync/push failed (413)")) : applyAll(deviceId, mutations),
    );
    const order = (await db.outbox.orderBy("seq").toArray()).map((entry) => entry.mutationId);

    expect(await pushOutbox(db)).toBe("ok");

    const delivered = sentBatches().filter((batch) => batch.length <= 2).flat().map((mutation) => mutation.mutationId);
    expect(delivered).toEqual(order);
    expect(await db.outbox.count()).toBe(0);
  });

  it("fails only a single mutation that is too large on its own and pushes the rest", async () => {
    await queueCards(3);
    const [, big] = await db.outbox.orderBy("seq").toArray();
    pushMutations.mockImplementation((deviceId: string, mutations: Mutation[]) =>
      mutations.some((mutation) => mutation.mutationId === big!.mutationId)
        ? Promise.reject(new ApiError(413, "too large"))
        : applyAll(deviceId, mutations),
    );

    expect(await pushOutbox(db)).toBe("ok");

    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ mutationId: big!.mutationId, status: "failed", attempts: 1, lastError: expect.stringContaining("TOO_LARGE") }),
    ]);
  });
});
