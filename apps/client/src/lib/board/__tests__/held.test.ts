import { afterAll, describe, expect, it, vi } from "vitest";
import type { LocalCasualtyCard } from "@/lib/db";

/**
 * A page reload: fresh modules (registry, stores, save banner) over the same IndexedDB, so
 * only what was persisted survives (P2-031).
 */
const opened: { close: () => void }[] = [];

async function reload() {
  vi.resetModules();
  const board = await import("../store");
  const data = await import("@/lib/db");
  const status = await import("@/lib/forms/save-status");
  opened.push(data.db);
  return {
    ...board,
    repo: data.casualtyRepo,
    db: data.db,
    clearLocalCards: data.clearLocalCards,
    heldEntries: () => data.listHeldBoardEdits(data.db),
    getSaveStatus: status.getSaveStatus,
  };
}

type App = Awaited<ReturnType<typeof reload>>;

afterAll(() => {
  for (const db of opened) db.close();
});

function vital(pulseRate: number) {
  return {
    measuredAt: new Date(2026, 9, 1, 8, 0, 0).toISOString(),
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

async function stored(app: App, id: string): Promise<LocalCasualtyCard> {
  return (await app.repo.getById(id))!;
}

function pulses(card: LocalCasualtyCard) {
  return card.vitalSigns.filter((row) => row.deletedAt == null).map((row) => row.pulseRate);
}

/** Opens a card on a fresh "page" and waits until its held edits, if any, are restored. */
async function open(app: App, id: string) {
  const store = app.boardForCard(await stored(app, id));
  app.retainBoard(store);
  await store.restoreHeld();
  return store;
}

/** A vitals row edited here (61) and on another device (65): held until the medic chooses. */
async function heldRow() {
  const app = await reload();
  const card = await app.repo.create({ lastName: "Held" });
  const row = await app.repo.upsertChild(card.id, "vitalSigns", vital(60));
  const board = await open(app, card.id);
  board.upsertVital({ ...row, pulseRate: 61 });
  await app.repo.upsertChild(card.id, "vitalSigns", { ...vital(65), id: row.id });
  expect(await board.flush()).toBe(true);
  expect(board.getSnapshot().remote).toBe(true);
  expect(pulses(await stored(app, card.id))).toEqual([65]);
  return { id: card.id, rowId: row.id };
}

// Each reload re-imports the app modules, which takes a second or two.
describe("held clinical edits across a reload (P2-031)", { timeout: 30_000 }, () => {
  it("brings back a held row with the banner, and saves it when the medic keeps their edits", async () => {
    const { id } = await heldRow();

    const app = await reload();
    const board = await open(app, id);
    expect(board.getSnapshot().remote).toBe(true);
    expect(board.getSnapshot().vitals.map((row) => row.pulseRate)).toEqual([61]);
    expect(app.getSaveStatus().board.invalid).toEqual(["vitals"]);
    expect(pulses(await stored(app, id))).toEqual([65]);

    board.keepEdits();
    expect(await board.flush()).toBe(true);
    expect(pulses(await stored(app, id))).toEqual([61]);

    // Resolved: the next reload brings nothing back.
    const next = await reload();
    const again = await open(next, id);
    expect(again.getSnapshot().remote).toBe(false);
    expect(next.getSaveStatus().board.invalid).toEqual([]);
    await next.repo.softDelete(id);
  });

  it("brings back a held allergy, and drops it when the medic loads the update", async () => {
    const first = await reload();
    const card = await first.repo.create({ lastName: "Allergy" });
    const board = await open(first, card.id);
    board.editIdentity({ allergies: "PENICILLIN" });
    await first.repo.updateFields(card.id, { allergies: "NKDA" });
    expect(await board.flush()).toBe(true);
    expect(first.getSaveStatus().board.invalid).toEqual(["allergies"]);

    const app = await reload();
    const reopened = await open(app, card.id);
    expect(reopened.getSnapshot().identity.allergies).toBe("PENICILLIN");
    expect(reopened.getSnapshot().remote).toBe(true);
    expect(app.getSaveStatus().board.invalid).toEqual(["allergies"]);

    reopened.loadUpdate();
    expect(await reopened.flush()).toBe(true);
    expect((await stored(app, card.id)).allergies).toBe("NKDA");
    expect(reopened.getSnapshot().identity.allergies).toBe("NKDA");

    const next = await reload();
    expect((await open(next, card.id)).getSnapshot().remote).toBe(false);
    await next.repo.softDelete(card.id);
  });

  it("lists held edits at start-up without the card being opened", async () => {
    const { id } = await heldRow();

    const app = await reload();
    expect(app.getSaveStatus().board.invalid).toEqual([]);
    await app.restoreHeldBoards();
    expect(app.getSaveStatus().board.invalid).toEqual(["vitals"]);
    const board = app.peekBoard(id);
    expect(board?.getSnapshot().remote).toBe(true);
    expect(app.liveBoards().has(board!)).toBe(true);
    board!.keepEdits();
    await board!.flush();
    await app.repo.softDelete(id);
  });

  it("does not clear the kept edits when the card updates before they are back", async () => {
    const { id } = await heldRow();
    const app = await reload();
    const board = app.boardForCard(await stored(app, id));
    app.retainBoard(board);
    // The open card's live query arrives before the kept edits are read back.
    board.hydrate(await stored(app, id));
    await board.restoreHeld();
    expect(board.getSnapshot().remote).toBe(true);
    expect(board.getSnapshot().vitals.map((row) => row.pulseRate)).toEqual([61]);
    expect(Object.keys(await app.heldEntries())).toContain(id);
    board.keepEdits();
    await board.flush();
    await app.repo.softDelete(id);
  });

  it("keeps the kept value locally until the save after Keep my edits succeeds", async () => {
    const { id } = await heldRow();
    const app = await reload();
    const board = await open(app, id);
    vi.spyOn(app.repo, "upsertChild").mockRejectedValueOnce(new Error("simulated disk failure"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    board.keepEdits();
    expect(await board.flush()).toBe(false);
    expect(pulses(await stored(app, id))).toEqual([65]);
    vi.restoreAllMocks();

    // Killed before a retry: the medic's value comes back, held for a choice again.
    const next = await reload();
    const again = await open(next, id);
    expect(again.getSnapshot().remote).toBe(true);
    expect(again.getSnapshot().vitals.map((row) => row.pulseRate)).toEqual([61]);
    again.keepEdits();
    expect(await again.flush()).toBe(true);
    expect(pulses(await stored(next, id))).toEqual([61]);
    expect(await next.heldEntries()).toEqual({});
    await next.repo.softDelete(id);
  });

  it("keeps a held removal of a row the other device changed", async () => {
    const app = await reload();
    const card = await app.repo.create({ lastName: "Removed" });
    const row = await app.repo.upsertChild(card.id, "vitalSigns", vital(60));
    const board = await open(app, card.id);
    board.removeVital(row.id);
    await app.repo.upsertChild(card.id, "vitalSigns", { ...vital(65), id: row.id });
    expect(await board.flush()).toBe(true);
    expect(pulses(await stored(app, card.id))).toEqual([65]);

    const next = await reload();
    const again = await open(next, card.id);
    expect(again.getSnapshot().remote).toBe(true);
    expect(again.getSnapshot().vitals).toEqual([]);
    again.keepEdits();
    expect(await again.flush()).toBe(true);
    expect(pulses(await stored(next, card.id))).toEqual([]);
    await next.repo.softDelete(card.id);
  });

  it("keeps a held tourniquet type without moving its applied time", async () => {
    const app = await reload();
    const card = await app.repo.create({ lastName: "Tourniquet" });
    const appliedAt = new Date(2026, 9, 1, 9, 55).toISOString();
    await app.repo.upsertChild(card.id, "tourniquet", { limb: "RIGHT_ARM", type: "CAT", appliedAt });
    const board = await open(app, card.id);
    board.setLimbTourniquet("RIGHT_ARM" as never, "SOFTT-W");
    await app.repo.upsertChild(card.id, "tourniquet", { limb: "RIGHT_ARM", type: "CAT Gen7", appliedAt });
    expect(await board.flush()).toBe(true);

    const next = await reload();
    const again = await open(next, card.id);
    expect(again.getSnapshot().tourniquets).toEqual([expect.objectContaining({ type: "SOFTT-W", appliedAt })]);
    again.keepEdits();
    expect(await again.flush()).toBe(true);
    const kept = (await stored(next, card.id)).tourniquets.filter((row) => row.deletedAt == null);
    expect(kept).toEqual([expect.objectContaining({ type: "SOFTT-W", appliedAt })]);
    await next.repo.softDelete(card.id);
  });

  it("keeps the medic's newer edit made before the kept edits are back, still held", async () => {
    const first = await reload();
    const card = await first.repo.create({ lastName: "Typed" });
    const board = await open(first, card.id);
    board.editIdentity({ allergies: "PENICILLIN" });
    await first.repo.updateFields(card.id, { allergies: "NKDA" });
    await board.flush();

    const app = await reload();
    const again = app.boardForCard(await stored(app, card.id));
    app.retainBoard(again);
    again.editIdentity({ allergies: "LATEX" });
    await again.restoreHeld();
    expect(again.getSnapshot().identity.allergies).toBe("LATEX");
    expect(again.getSnapshot().remote).toBe(true);
    await again.flush();
    expect((await stored(app, card.id)).allergies).toBe("NKDA");
    again.loadUpdate();
    await again.flush();
    await app.repo.softDelete(card.id);
  });

  it("clears kept edits of a card no longer on this device at start-up", async () => {
    const { id } = await heldRow();
    const app = await reload();
    await app.db.casualties.delete(id);
    await app.restoreHeldBoards();
    expect(await app.heldEntries()).toEqual({});
    expect(app.getSaveStatus().board.invalid).toEqual([]);
  });

  it("blocks clearing local cards only for held edits on a card that can still be opened", async () => {
    const { id } = await heldRow();
    const app = await reload();
    await app.db.outbox.clear(); // as if every queued change had synced
    expect(await app.clearLocalCards(app.db)).toBe("held");
    expect(await stored(app, id)).toBeTruthy();

    // Deleted on another device: the edits cannot be chosen for any more, so they no longer block.
    await app.repo.softDelete(id);
    await app.db.outbox.clear();
    expect(await app.clearLocalCards(app.db)).toBeNull();
    expect(await app.repo.getById(id)).toBeUndefined();
    expect(await app.heldEntries()).toEqual({});
  });

  it("retries a failed write of the held edits on the next flush", async () => {
    const app = await reload();
    const card = await app.repo.create({ lastName: "Write" });
    const row = await app.repo.upsertChild(card.id, "vitalSigns", vital(60));
    const board = await open(app, card.id);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const put = app.db.meta.put.bind(app.db.meta);
    let failed = false;
    vi.spyOn(app.db.meta, "put").mockImplementation(((entry: Parameters<typeof put>[0]) => {
      if (entry.key === "heldBoardEdits" && !failed) {
        failed = true;
        return Promise.reject(new Error("simulated disk failure"));
      }
      return put(entry);
    }) as never);
    board.upsertVital({ ...row, pulseRate: 61 });
    await app.repo.upsertChild(card.id, "vitalSigns", { ...vital(65), id: row.id });
    await board.flush();
    expect(board.heldFailed).toBe(true);
    expect(app.getSaveStatus().board.failed).toBe(true);
    expect(await app.heldEntries()).toEqual({});

    await board.flush();
    expect(board.heldFailed).toBe(false);
    expect(Object.keys(await app.heldEntries())).toEqual([card.id]);
    vi.restoreAllMocks();
    board.keepEdits();
    await board.flush();
    await app.repo.softDelete(card.id);
  });

  it("retries a failed restore, then lets the store go once nothing is held", async () => {
    const { id } = await heldRow();
    const app = await reload();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(app.db.meta, "get").mockRejectedValueOnce(new Error("simulated read failure"));
    const board = app.boardForCard(await stored(app, id));
    await board.restoreHeld();
    expect(board.heldFailed).toBe(true);
    expect(board.isSettled()).toBe(false);
    vi.restoreAllMocks();

    await board.flush();
    await board.restoreHeld();
    expect(board.heldFailed).toBe(false);
    expect(board.getSnapshot().remote).toBe(true);
    board.keepEdits();
    await board.flush();
    await vi.waitFor(() => expect(app.liveBoards().has(board)).toBe(false));
    await app.repo.softDelete(id);
  });

  it("drops a kept value the medic saved a newer one over before it was back", async () => {
    const { emptySnapshot } = await import("../snapshot");
    const { emptyPendingRows } = await import("../pending");
    const { restoreHeldEdits } = await import("../held");
    const current = emptySnapshot("card");
    current.identity = { ...current.identity, allergies: "LATEX" };
    const restored = restoreHeldEdits({ fields: { allergies: "PENICILLIN" }, rows: {} }, current, current, new Set(), emptyPendingRows(), {
      fields: new Set(["allergies"]),
      rows: new Set(),
    });
    expect(restored.clash).toBeNull();
    expect(restored.snapshot.identity.allergies).toBe("LATEX");
  });

  it("keeps a held row column when only another column of the row was saved before it was back", async () => {
    const { emptySnapshot } = await import("../snapshot");
    const { emptyPendingRows } = await import("../pending");
    const { restoreHeldEdits } = await import("../held");
    const row = { id: "r1", ...vital(65), spo2: 97, clientUpdatedAt: "", deletedAt: null };
    const current = emptySnapshot("card");
    current.vitals = [row];
    const held = { fields: {}, rows: { vitals: { r1: { row: { ...row, pulseRate: 61, spo2: null }, columns: ["pulseRate"] } } } };
    const restored = restoreHeldEdits(held, current, current, new Set(), emptyPendingRows(), {
      fields: new Set(),
      rows: new Set(["vitals:r1:spo2"]),
    });
    expect(restored.clash?.rows.vitals.get("r1")).toEqual(row);
    expect(restored.snapshot.vitals).toEqual([{ ...row, pulseRate: 61 }]);
    expect([...restored.rows.vitals.changed.get("r1")!]).toEqual(["pulseRate"]);

    const superseded = restoreHeldEdits(held, current, current, new Set(), emptyPendingRows(), {
      fields: new Set(),
      rows: new Set(["vitals:r1:pulseRate"]),
    });
    expect(superseded.clash).toBeNull();
  });

  it("drops a held edit the other device has since matched", async () => {
    const { id, rowId } = await heldRow();
    const app = await reload();
    await app.repo.upsertChild(id, "vitalSigns", { ...vital(61), id: rowId });

    const board = await open(app, id);
    expect(board.getSnapshot().remote).toBe(false);
    expect(board.getSnapshot().vitals.map((row) => row.pulseRate)).toEqual([61]);
    expect(app.getSaveStatus().board.invalid).toEqual([]);

    const next = await reload();
    expect((await open(next, id)).getSnapshot().remote).toBe(false);
    await next.repo.softDelete(id);
  });
});
