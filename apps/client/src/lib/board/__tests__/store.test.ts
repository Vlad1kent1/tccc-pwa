import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AirwayTreatment,
  BodyView,
  CirculationTreatment,
  FluidKind,
  Limb,
  MedicationCategory,
  Route,
  newId,
} from "@tccc/shared";
import { casualtyRepo, db as appDb, type LocalCasualtyCard } from "@/lib/db";
import { clearSaveStatus, getSaveStatus, retrySave } from "@/lib/forms/save-status";
import { vitalColumn } from "@tccc/dd1380";
import { paperRow, rowForColumn, saveVitalSlot } from "../rows";
import { createCasualtyRepo, type CasualtyRepo } from "@/lib/db/casualtyRepo";
import { TcccDB } from "@/lib/db/schema";
import { commitBoard } from "../commit";
import { emptyPendingRows } from "../pending";
import {
  boardForCard,
  createDraftBoard,
  flushAllBoards,
  liveBoards,
  peekBoard,
  releaseBoard,
  retainBoard,
  type BoardStore,
} from "../store";
import { emptySnapshot } from "../snapshot";

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);

let db: TcccDB;
let repo: CasualtyRepo;
/** Stores a test mounted; released after it, as an unmounting screen would. */
let mounted: BoardStore[] = [];

function mount(store: BoardStore): BoardStore {
  retainBoard(store);
  mounted.push(store);
  return store;
}

function draft(): BoardStore {
  return mount(createDraftBoard());
}

async function open(card: LocalCasualtyCard): Promise<BoardStore> {
  const store = mount(boardForCard(card));
  store.hydrate((await casualtyRepo.getById(card.id))!);
  return store;
}

beforeEach(() => {
  db = new TcccDB(`tccc-test-${crypto.randomUUID()}`);
  repo = createCasualtyRepo(db, () => T0);
});

afterEach(async () => {
  for (const store of mounted) releaseBoard(store);
  mounted = [];
  await flushAllBoards();
  await db.delete();
});

afterAll(() => {
  appDb.close();
});

describe("board store", () => {
  it("keeps the injury list reference when notes change", () => {
    const board = draft();
    const injuries = board.getSnapshot().injuries;
    board.editNotes("under fire");
    expect(board.getSnapshot().notes).toBe("under fire");
    expect(board.getSnapshot().injuries).toBe(injuries);
  });

  it("keeps a trailing space or newline on screen after the debounced save comes back (P1-007)", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler" }, "now");
    expect(await board.save()).toBe(true);
    const id = board.cardId!;

    // Keystroke by keystroke, with a pause (a save and a live card update) after the space.
    for (const text of ["V", "Va", "Van", "Van "]) board.editIdentity({ firstName: text });
    for (const text of ["line one", "line one\n"]) board.editNotes(text);
    for (const text of ["CAT", "CAT "]) board.editTreatments({ circulationTqType: text }, "debounce");
    expect(await board.flush()).toBe(true);
    board.hydrate((await casualtyRepo.getById(id))!);
    expect(board.getSnapshot().identity.firstName).toBe("Van ");
    expect(board.getSnapshot().notes).toBe("line one\n");
    expect(board.getSnapshot().treatments.circulationTqType).toBe("CAT ");

    for (const text of ["Van D", "Van Da", "Van Damme"]) board.editIdentity({ firstName: text });
    board.editNotes("line one\nline two");
    board.editTreatments({ circulationTqType: "CAT Gen7" }, "debounce");
    expect(await board.flush()).toBe(true);
    const stored = (await casualtyRepo.getById(id))!;
    expect(stored.firstName).toBe("Van Damme");
    expect(stored.notes).toBe("line one\nline two");
    expect(stored.circulationTqType).toBe("CAT Gen7");
  });

  it("still takes a stored value that differs by more than trimming", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler", firstName: "Van " }, "now");
    expect(await board.save()).toBe(true);
    const id = board.cardId!;
    await casualtyRepo.updateFields(id, { firstName: "Ivan" });
    board.hydrate((await casualtyRepo.getById(id))!);
    expect(board.getSnapshot().identity.firstName).toBe("Ivan");
  });

  it("keeps the typed text when another field of its section changes remotely", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler" }, "now");
    expect(await board.save()).toBe(true);
    const id = board.cardId!;
    for (const text of ["V", "Va", "Van", "Van "]) board.editIdentity({ firstName: text });
    board.editIdentity({ allergies: " " });
    expect(await board.flush()).toBe(true);
    await casualtyRepo.updateFields(id, { unit: "1 Bn" });
    board.hydrate((await casualtyRepo.getById(id))!);
    const { identity } = board.getSnapshot();
    expect(identity.unit).toBe("1 Bn");
    expect(identity.firstName).toBe("Van ");
    expect(identity.allergies).toBe(" ");
    expect((await casualtyRepo.getById(id))!.allergies).toBeNull();
  });

  it("writes treatments, vitals, fluids, medications, notes, and responder", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler" }, "now");
    expect(await board.save()).toBe(true);
    const id = board.cardId;
    expect(id).toBeTruthy();

    board.editNotes("under fire");
    board.editResponder({ responderName: "Medic, A", responderLast4: "1234" });
    board.editTreatments({ airway: [AirwayTreatment.NPA], circulation: [CirculationTreatment.HEMOSTATIC] });
    const measuredAt = new Date(2026, 9, 1, 8, 15).toISOString();
    board.upsertVital(
      {
        id: newId(),
        measuredAt,
        pulseRate: 110,
        pulseLocation: "carotid",
        systolic: 90,
        diastolic: 60,
        respiratoryRate: 22,
        spo2: 94,
        avpu: null,
        painScale: 3,
        clientUpdatedAt: "",
        deletedAt: null,
      },
      "now",
    );
    board.upsertFluid(
      {
        id: newId(),
        kind: FluidKind.FLUID,
        name: "LR",
        volumeMl: 500,
        route: Route.IV,
        administeredAt: measuredAt,
        clientUpdatedAt: "",
        deletedAt: null,
      },
      "now",
    );
    board.upsertMedication(
      {
        id: newId(),
        category: MedicationCategory.ANALGESIC,
        name: "Ketamine",
        dose: "50 mg",
        route: Route.IM,
        administeredAt: measuredAt,
        clientUpdatedAt: "",
        deletedAt: null,
      },
      "now",
    );
    board.placeInjury(BodyView.FRONT, 0.42, 0.33);
    expect(await board.save()).toBe(true);

    const card = await casualtyRepo.getById(id!);
    expect(card?.notes).toBe("under fire");
    expect(card?.responderName).toBe("Medic, A");
    expect(card?.responderLast4).toBe("1234");
    expect(card?.airway).toEqual([AirwayTreatment.NPA]);
    expect(card?.circulation).toEqual([CirculationTreatment.HEMOSTATIC]);
    expect(card?.vitalSigns.filter((row) => row.deletedAt == null)).toEqual([
      expect.objectContaining({ pulseRate: 110, pulseLocation: "carotid", painScale: 3 }),
    ]);
    expect(card?.fluids.filter((row) => row.deletedAt == null)).toEqual([
      expect.objectContaining({ kind: FluidKind.FLUID, name: "LR", volumeMl: 500 }),
    ]);
    expect(card?.medications.filter((row) => row.deletedAt == null)).toEqual([
      expect.objectContaining({ category: MedicationCategory.ANALGESIC, name: "Ketamine", dose: "50 mg" }),
    ]);
    const marks = card?.injurySites.filter((row) => row.deletedAt == null) ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.x).toBeCloseTo(0.42);
    expect(marks[0]?.y).toBeCloseTo(0.33);
    expect(marks[0]?.view).toBe(BodyView.FRONT);

    board.hydrate(card!);
    expect(board.getSnapshot().notes).toBe("under fire");
    expect(board.getSnapshot().vitals).toHaveLength(1);
    expect(board.getSnapshot().remote).toBe(false);

    if (id) await casualtyRepo.softDelete(id);
  });

  it("saves paper treatment details as card fields and queues them for sync", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler" }, "now");
    board.editTreatments({ circulation: [CirculationTreatment.DRESSING] });
    board.editTreatments({ dressingOtherType: "Israeli", circulationDressingType: "Z-fold" }, "debounce");
    expect(await board.save()).toBe(true);
    const id = board.cardId!;

    const card = await casualtyRepo.getById(id);
    expect(card).toMatchObject({ dressingOtherType: "Israeli", circulationDressingType: "Z-fold" });
    const queued = await appDb.outbox.where("cardId").equals(id).toArray();
    expect(
      queued.some((entry) => entry.op === "card.upsert" && entry.changedFields.includes("dressingOtherType")),
    ).toBe(true);

    const reopened = await open(card!);
    expect(reopened).toBe(board);
    expect(reopened.getSnapshot().treatments.dressingOtherType).toBe("Israeli");
    expect(reopened.getSnapshot().treatments.circulation).toEqual([CirculationTreatment.DRESSING]);
    await casualtyRepo.softDelete(id);
  });

  it("stores a tourniquet placement with the circulation flag", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler" }, "now");
    board.editTreatments({ tqJunctional: true });
    await board.flush();
    const id = board.cardId!;

    const card = await casualtyRepo.getById(id);
    expect(card).toMatchObject({ tqJunctional: true, tqExtremity: false });
    expect(card?.circulation).toEqual([CirculationTreatment.TOURNIQUET]);
    await casualtyRepo.softDelete(id);
  });

  it("keeps a tourniquet's id and applied time when its type is cleared and retyped (P0-002)", async () => {
    const appliedAt = new Date(2026, 9, 1, 14, 5).toISOString();
    const card = await casualtyRepo.create({ lastName: "Adler" });
    await casualtyRepo.upsertChild(card.id, "tourniquet", { limb: Limb.RIGHT_ARM, type: "CAT", appliedAt });
    const original = (await casualtyRepo.getById(card.id))!.tourniquets[0]!;
    const board = await open(card);
    const before = await appDb.outbox.where("cardId").equals(card.id).count();

    // Backspace "CAT" to blank, then the type box loses focus while blank.
    for (const text of ["CA", "C", ""]) board.setLimbTourniquet(Limb.RIGHT_ARM, text);
    await board.flush();
    expect(activeTourniquets(await casualtyRepo.getById(card.id))).toEqual([
      expect.objectContaining({ id: original.id, appliedAt }),
    ]);

    // Focus comes back and the correct type is typed key by key.
    for (const text of ["S", "SO", "SOF", "SOFT", "SOFTT", "SOFTT-", "SOFTT-W"]) board.setLimbTourniquet(Limb.RIGHT_ARM, text);
    await board.flush();

    const fresh = await casualtyRepo.getById(card.id);
    expect(activeTourniquets(fresh)).toEqual([expect.objectContaining({ id: original.id, type: "SOFTT-W", appliedAt })]);
    expect(board.getSnapshot().tourniquets).toEqual([expect.objectContaining({ id: original.id, type: "SOFTT-W", appliedAt })]);
    const queued = (await appDb.outbox.where("cardId").equals(card.id).toArray()).slice(before);
    expect(queued.some((entry) => entry.op === "child.delete")).toBe(false);
    await casualtyRepo.softDelete(card.id);
  });

  it("restores and saves the type from focus when slow backspacing autosaved a partial type (P0-002)", async () => {
    const appliedAt = new Date(2026, 9, 1, 14, 5).toISOString();
    const card = await casualtyRepo.create({ lastName: "Adler" });
    await casualtyRepo.upsertChild(card.id, "tourniquet", { limb: Limb.RIGHT_ARM, type: "CAT", appliedAt });
    const original = (await casualtyRepo.getById(card.id))!.tourniquets[0]!;
    const board = await open(card);

    board.focusTourniquetType(Limb.RIGHT_ARM);
    // Slow backspacing: the autosave runs after each key.
    for (const text of ["CA", "C", ""]) {
      board.setLimbTourniquet(Limb.RIGHT_ARM, text);
      await board.flush();
    }
    expect(activeTourniquets(await casualtyRepo.getById(card.id))[0]?.type).toBe("C");

    expect(board.leaveTourniquetType(Limb.RIGHT_ARM, "")).toBe(true);
    await board.flush();

    const restored = { id: original.id, type: "CAT", appliedAt };
    expect(board.getSnapshot().tourniquets).toEqual([expect.objectContaining(restored)]);
    expect(activeTourniquets(await casualtyRepo.getById(card.id))).toEqual([expect.objectContaining(restored)]);
    await casualtyRepo.softDelete(card.id);
  });

  it("deletes a tourniquet only through the explicit Remove action (P0-002)", async () => {
    const appliedAt = new Date(2026, 9, 1, 14, 5).toISOString();
    const card = await casualtyRepo.create({ lastName: "Adler" });
    await casualtyRepo.upsertChild(card.id, "tourniquet", { limb: Limb.LEFT_LEG, type: "CAT", appliedAt });
    const board = await open(card);

    board.setLimbTourniquet(Limb.LEFT_LEG, "");
    await board.flush();
    expect(activeTourniquets(await casualtyRepo.getById(card.id))).toEqual([
      expect.objectContaining({ limb: Limb.LEFT_LEG, type: "CAT", appliedAt }),
    ]);

    board.removeTourniquet(Limb.LEFT_LEG);
    await board.flush();
    expect(activeTourniquets(await casualtyRepo.getById(card.id))).toEqual([]);
    expect(board.getSnapshot().tourniquets).toEqual([]);
    const queued = await appDb.outbox.where("cardId").equals(card.id).toArray();
    expect(queued.some((entry) => entry.op === "child.delete" && entry.entity === "tourniquet")).toBe(true);
    await casualtyRepo.softDelete(card.id);
  });

  it("keeps a partial last 4 on screen without saving or flagging it", async () => {
    const board = draft();
    board.editIdentity({ lastName: "Adler" }, "now");
    await board.flush();
    const id = board.cardId!;

    board.editIdentity({ casualtyLast4: "04" });
    await board.flush();
    expect((await casualtyRepo.getById(id))?.casualtyLast4).toBeNull();
    expect(board.getSnapshot().identity.casualtyLast4).toBe("04");
    expect(getSaveStatus().board.invalid).toEqual([]);

    board.editIdentity({ casualtyLast4: "0427" });
    expect(await board.save()).toBe(true);
    expect((await casualtyRepo.getById(id))?.casualtyLast4).toBe("0427");
    await casualtyRepo.softDelete(id);
  });

  it("creates a card for an unidentified casualty on the first vital", async () => {
    const board = draft();
    board.upsertVital(draftVital(130), "now");
    await board.flush();
    const id = board.cardId;
    expect(id).toBeTruthy();

    const card = await casualtyRepo.getById(id!);
    expect(card?.lastName).toBeNull();
    expect(card?.vitalSigns.filter((row) => row.deletedAt == null).map((row) => row.pulseRate)).toEqual([130]);

    await casualtyRepo.softDelete(id!);
  });

  it("creates a card when only a paper-card detail was entered", async () => {
    const board = draft();
    board.editIdentity({ unit: "1 BN" });
    await board.flush();
    const id = board.cardId;
    expect(id).toBeTruthy();

    expect((await casualtyRepo.getById(id!))?.unit).toBe("1 BN");
    await casualtyRepo.softDelete(id!);
  });
});

describe("per-card stores", () => {
  it("gives each card its own store, so a draft's edits never reach another card", async () => {
    const other = await casualtyRepo.create({ lastName: "Alpha" });
    await casualtyRepo.upsertChild(other.id, "vitalSigns", vitalInput(72));

    const fresh = draft();
    fresh.upsertVital(draftVital(140));
    const opened = await open(other);
    fresh.hydrate((await casualtyRepo.getById(other.id))!);

    expect(opened).not.toBe(fresh);
    expect(fresh.cardId).toBeNull();
    expect(opened.getSnapshot().vitals.map((row) => row.pulseRate)).toEqual([72]);
    await flushAllBoards();

    const stored = await casualtyRepo.getById(other.id);
    expect(stored!.vitalSigns.filter((row) => row.deletedAt == null).map((row) => row.pulseRate)).toEqual([72]);
    expect(fresh.cardId).not.toBe(other.id);
    const draftCard = await casualtyRepo.getById(fresh.cardId!);
    expect(draftCard!.vitalSigns.map((row) => row.pulseRate)).toEqual([140]);

    await casualtyRepo.softDelete(other.id);
    await casualtyRepo.softDelete(draftCard!.id);
  });

  it("hands every screen of a card the same store while one is open", async () => {
    const card = await casualtyRepo.create({ lastName: "Hotel" });
    const sheet = await open(card);
    const board = await open(card);
    expect(board).toBe(sheet);
    expect(peekBoard(card.id)).toBe(sheet);
    await casualtyRepo.softDelete(card.id);
  });

  it("registers a draft under the card it creates", async () => {
    const board = draft();
    board.editIdentity({ lastName: "India" }, "now");
    await board.flush();
    const card = (await casualtyRepo.getById(board.cardId!))!;
    expect(peekBoard(card.id)).toBe(board);
    expect(boardForCard(card)).toBe(board);
    await casualtyRepo.softDelete(card.id);
  });

  it("drops a closed store only after its pending save has drained", async () => {
    const card = await casualtyRepo.create({ lastName: "Juliett" });
    const store = mount(boardForCard(card));
    store.editNotes("pelvic binder");
    mounted = [];
    releaseBoard(store);
    expect(liveBoards().has(store)).toBe(true);

    await vi.waitFor(() => expect(liveBoards().has(store)).toBe(false));
    expect(peekBoard(card.id)).toBeUndefined();
    expect((await casualtyRepo.getById(card.id))?.notes).toBe("pelvic binder");

    const next = boardForCard((await casualtyRepo.getById(card.id))!);
    expect(next).not.toBe(store);
    expect(next.getSnapshot().notes).toBe("pelvic binder");
    retainBoard(next);
    releaseBoard(next);
    await casualtyRepo.softDelete(card.id);
  });
});

describe("paper columns", () => {
  async function openWithVitals(hours: number[]) {
    const card = await casualtyRepo.create({ lastName: "Golf" });
    const rows = [];
    for (const [index, hour] of hours.entries()) {
      rows.push(await casualtyRepo.upsertChild(card.id, "vitalSigns", { ...vitalInput(80 + index * 40), measuredAt: atHour(hour) }));
    }
    const board = await open(card);
    board.resetPaperLayout();
    return { id: card.id, rows, board };
  }

  function atHour(hour: number): string {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  }

  it("keeps editing the same row after its time is corrected past another row", async () => {
    const { id, rows, board } = await openWithVitals([1, 2]);
    saveVitalSlot(board, 0, { time: "0300" });
    expect(paperRow(board.getSnapshot(), board.getSnapshot().vitals, vitalColumn(0))?.id).toBe(rows[0]!.id);

    saveVitalSlot(board, 0, { pulse: "60" });
    await board.flush();
    const stored = (await casualtyRepo.getById(id))!.vitalSigns;
    expect(stored.find((row) => row.id === rows[0]!.id)?.pulseRate).toBe(60);
    expect(stored.find((row) => row.id === rows[1]!.id)?.pulseRate).toBe(120);
    await casualtyRepo.softDelete(id);
  });

  it("saves a vitals time typed digit by digit on today, with no injury time (P0-001)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 10, 14, 10, 0));
      const board = draft();
      expect(board.getSnapshot().identity.injuredAt).toBeNull();
      for (const time of ["1", "14", "140", "1405"]) saveVitalSlot(board, 0, { time });

      const row = paperRow(board.getSnapshot(), board.getSnapshot().vitals, vitalColumn(0));
      expect(row?.measuredAt).toBe(new Date(2026, 10, 10, 14, 5, 0).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates one row when typing into an empty column past the filled ones", async () => {
    const { id, board } = await openWithVitals([1]);
    saveVitalSlot(board, 3, { pulse: "9" });
    saveVitalSlot(board, 3, { pulse: "98" });
    await board.flush();

    const live = (await casualtyRepo.getById(id))!.vitalSigns.filter((row) => row.deletedAt == null);
    expect(live).toHaveLength(2);
    expect(paperRow(board.getSnapshot(), board.getSnapshot().vitals, vitalColumn(3))?.pulseRate).toBe(98);
    expect(paperRow(board.getSnapshot(), board.getSnapshot().vitals, vitalColumn(1))).toBeUndefined();
    await casualtyRepo.softDelete(id);
  });
});

describe("board save failures", () => {
  beforeEach(() => {
    clearSaveStatus("board");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openCard(lastName: string) {
    const card = await casualtyRepo.create({ lastName });
    return { id: card.id, board: await open(card) };
  }

  /** A paper vitals time cell, keystroke by keystroke: focus is claimed before each save, released on blur. */
  function typeVitalTime(board: BoardStore, keystrokes: string[]): string {
    let id = "";
    for (const time of keystrokes) {
      id = rowForColumn(board, vitalColumn(0));
      board.focusTimeBox(id);
      saveVitalSlot(board, 0, { time });
      expect(getSaveStatus().board.invalid, `while typing "${time}"`).toEqual([]);
    }
    board.focusTimeBox(null);
    return id;
  }

  it("flags a time box left with an unfinished time until a complete time is typed (P0-001)", async () => {
    const { id, board } = await openCard("Hotel");
    const rowId = typeVitalTime(board, ["9", "90", "905"]);
    expect(board.isTimeBoxUnfinished(rowId)).toBe(true);
    expect(getSaveStatus().board.invalid).toEqual(["vitals"]);

    // A save does not clear it: the box still shows a time that is not the stored one.
    board.editNotes("pulse weak");
    await board.flush();
    expect(getSaveStatus().board.invalid).toEqual(["vitals"]);

    typeVitalTime(board, ["0", "09", "090", "0905"]);
    expect(board.isTimeBoxUnfinished(rowId)).toBe(false);
    expect(getSaveStatus().board.invalid).toEqual([]);
    await casualtyRepo.softDelete(id);
  });

  it("shows the flag again when the card is reopened, and drops it when the row is deleted elsewhere (P0-001)", async () => {
    const card = await casualtyRepo.create({ lastName: "India" });
    const first = mount(boardForCard(card));
    const rowId = typeVitalTime(first, ["1", "14"]);
    expect(getSaveStatus().board.invalid).toEqual(["vitals"]);

    // The screen closes: the store drains, is dropped, and its flag goes with it.
    mounted = [];
    releaseBoard(first);
    await vi.waitFor(() => expect(liveBoards().has(first)).toBe(false));
    expect(getSaveStatus().board.invalid).toEqual([]);

    // Reopened (after a reload, or on another device after a pull): "14" is still in the row's draft.
    const reopened = await open((await casualtyRepo.getById(card.id))!);
    expect(reopened).not.toBe(first);
    expect(reopened.getSnapshot().rowDrafts[rowId]?.time).toBe("14");
    expect(reopened.isTimeBoxUnfinished(rowId)).toBe(true);
    expect(getSaveStatus().board.invalid).toEqual(["vitals"]);

    // Another device deletes the row; the pulled card no longer has it.
    await casualtyRepo.deleteChild(card.id, "vitalSigns", rowId);
    reopened.hydrate((await casualtyRepo.getById(card.id))!);
    expect(reopened.getSnapshot().vitals).toHaveLength(0);
    expect(getSaveStatus().board.invalid).toEqual([]);
    await casualtyRepo.softDelete(card.id);
  });

  it("flags the tourniquet time box on blur only, and clears it once complete (P0-001)", async () => {
    const { id, board } = await openCard("Juliett");
    board.checkTimeBox("tourniquet:RIGHT_LEG", "body", "905", true);
    expect(getSaveStatus().board.invalid).toEqual([]);
    board.checkTimeBox("tourniquet:RIGHT_LEG", "body", "905");
    expect(board.isTimeBoxUnfinished("tourniquet:RIGHT_LEG")).toBe(true);
    expect(getSaveStatus().board.invalid).toEqual(["body"]);
    board.checkTimeBox("tourniquet:RIGHT_LEG", "body", "0905", true);
    expect(getSaveStatus().board.invalid).toEqual([]);
    await casualtyRepo.softDelete(id);
  });

  it("stores whitespace-only text as empty and keeps saving later edits", async () => {
    const { id, board } = await openCard("Bravo");
    board.editIdentity({ lastName: " " }, "now");
    await board.flush();
    board.editNotes("TQ applied L leg");
    expect(await board.flush()).toBe(true);

    const card = await casualtyRepo.getById(id);
    expect(card?.lastName).toBeNull();
    expect(card?.notes).toBe("TQ applied L leg");
    expect(getSaveStatus().board).toMatchObject({ failed: false, invalid: [] });
    await casualtyRepo.softDelete(id);
  });

  it("leaves out an invalid field, saves the rest, and keeps the input on screen", async () => {
    const { id, board } = await openCard("Charlie");
    const tooLong = "x".repeat(501);
    board.editIdentity({ allergies: tooLong });
    board.editNotes("needle decompression");
    await board.flush();

    const card = await casualtyRepo.getById(id);
    expect(card?.notes).toBe("needle decompression");
    expect(card?.allergies).toBeNull();
    expect(getSaveStatus().board.invalid).toEqual(["allergies"]);
    expect(board.getSnapshot().identity.allergies).toBe(tooLong);
    expect(await board.save()).toBe(false);

    board.editIdentity({ allergies: "PENICILLIN" });
    expect(await board.save()).toBe(true);
    expect((await casualtyRepo.getById(id))?.allergies).toBe("PENICILLIN");
    expect(getSaveStatus().board.invalid).toEqual([]);
    await casualtyRepo.softDelete(id);
  });

  it("skips a row that cannot be stored without rolling back the other edits", async () => {
    const { id, board } = await openCard("Delta");
    board.upsertVital({ ...draftVital(90), measuredAt: "not a time" });
    board.editNotes("pulse weak");
    await board.flush();

    const card = await casualtyRepo.getById(id);
    expect(card?.notes).toBe("pulse weak");
    expect(card?.vitalSigns).toHaveLength(0);
    expect(getSaveStatus().board.invalid).toEqual(["vitals"]);
    expect(board.getSnapshot().vitals).toHaveLength(1);
    await casualtyRepo.softDelete(id);
  });

  it("reports a failed write and clears it once a retry succeeds", async () => {
    const { id, board } = await openCard("Echo");
    vi.spyOn(casualtyRepo, "updateFields").mockRejectedValueOnce(new Error("simulated disk failure"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    board.editNotes("ketamine 50 mg IM");
    expect(await board.flush()).toBe(false);
    expect(getSaveStatus().board).toMatchObject({ failed: true, canRetry: true });
    expect((await casualtyRepo.getById(id))?.notes).toBeNull();

    retrySave("board");
    await board.flush();
    expect((await casualtyRepo.getById(id))?.notes).toBe("ketamine 50 mg IM");
    expect(getSaveStatus().board.failed).toBe(false);
    await casualtyRepo.softDelete(id);
  });

  it("keeps the store of a closed card with a failed save, and drops it once the retry saves", async () => {
    const { id, board } = await openCard("Foxtrot");
    vi.spyOn(casualtyRepo, "updateFields").mockRejectedValueOnce(new Error("simulated disk failure"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    board.editNotes("tourniquet R arm 1405");
    mounted = [];
    releaseBoard(board);
    await vi.waitFor(() => expect(getSaveStatus().board.failed).toBe(true));
    expect(liveBoards().has(board)).toBe(true);

    retrySave("board");
    await vi.waitFor(() => expect(liveBoards().has(board)).toBe(false));
    expect((await casualtyRepo.getById(id))?.notes).toBe("tourniquet R arm 1405");
    expect(getSaveStatus().board.failed).toBe(false);
    await casualtyRepo.softDelete(id);
  });

  it("keeps a failure on one card visible while another card saves", async () => {
    const first = await openCard("Kilo");
    const second = await openCard("Lima");
    vi.spyOn(casualtyRepo, "updateFields").mockRejectedValueOnce(new Error("simulated disk failure"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    first.board.editNotes("chest seal");
    await first.board.flush();
    second.board.editNotes("NPA");
    await second.board.flush();
    expect(getSaveStatus().board.failed).toBe(true);

    await first.board.flush();
    expect(getSaveStatus().board.failed).toBe(false);
    await casualtyRepo.softDelete(first.id);
    await casualtyRepo.softDelete(second.id);
  });
});

function activeTourniquets(card: LocalCasualtyCard | undefined) {
  return (card?.tourniquets ?? []).filter((row) => row.deletedAt == null);
}

function vitalInput(pulseRate: number) {
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

function draftVital(pulseRate: number) {
  return { ...vitalInput(pulseRate), id: newId(), clientUpdatedAt: "", deletedAt: null };
}

describe("remote updates while the board has unsaved edits (P1-003)", () => {
  async function openWith(pulses: number[]) {
    const card = await casualtyRepo.create({ lastName: "Remote" });
    const rows = [];
    for (const pulse of pulses) rows.push(await casualtyRepo.upsertChild(card.id, "vitalSigns", vitalInput(pulse)));
    const board = await open((await casualtyRepo.getById(card.id))!);
    return { id: card.id, board, rows };
  }

  /** Another device's edit, as a pull lands it in Dexie. */
  async function pulled(id: string) {
    return (await casualtyRepo.getById(id))!;
  }

  async function storedPulses(id: string) {
    return (await pulled(id)).vitalSigns
      .filter((row) => row.deletedAt == null)
      .map((row) => row.pulseRate)
      .sort((a, b) => a! - b!);
  }

  function shownPulses(board: BoardStore) {
    return board
      .getSnapshot()
      .vitals.map((row) => row.pulseRate)
      .sort((a, b) => a! - b!);
  }

  it("does not delete a row another device added to the section being edited", async () => {
    const { id, board } = await openWith([60]);
    // The save runs before the board has seen the pulled row.
    board.upsertVital(draftVital(70));
    await casualtyRepo.upsertChild(id, "vitalSigns", vitalInput(80));
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([60, 70, 80]);

    // The board sees the pulled row while its own row is still unsaved.
    board.upsertVital(draftVital(90));
    await casualtyRepo.upsertChild(id, "vitalSigns", vitalInput(100));
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(false);
    expect(shownPulses(board)).toEqual([60, 70, 80, 90, 100]);
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([60, 70, 80, 90, 100]);
    await casualtyRepo.softDelete(id);
  });

  it("does not revert another device's edit to a different row", async () => {
    const { id, board, rows } = await openWith([60, 70]);
    const [first, second] = rows as [LocalCasualtyCard["vitalSigns"][number], LocalCasualtyCard["vitalSigns"][number]];
    board.upsertVital({ ...first, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(71), id: second.id });
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([61, 71]);

    board.upsertVital({ ...first, pulseRate: 62 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(72), id: second.id });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(false);
    expect(shownPulses(board)).toEqual([62, 72]);
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([62, 72]);
    await casualtyRepo.softDelete(id);
  });

  it("still deletes a row or tourniquet the medic removed", async () => {
    const { id, board, rows } = await openWith([60]);
    board.setLimbTourniquet(Limb.RIGHT_ARM, "CAT");
    expect(await board.flush()).toBe(true);
    await casualtyRepo.upsertChild(id, "vitalSigns", vitalInput(80));
    board.removeVital(rows[0]!.id);
    board.removeTourniquet(Limb.RIGHT_ARM);
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([80]);
    expect(activeTourniquets(await pulled(id))).toEqual([]);
    await casualtyRepo.softDelete(id);
  });

  it("keeps the banner for an edit to the same field until the medic loads the update", async () => {
    const { id, board } = await openWith([]);
    board.editIdentity({ firstName: "Local" });
    await casualtyRepo.updateFields(id, { firstName: "Remote" });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(true);
    expect(board.getSnapshot().identity.firstName).toBe("Local");

    // The later local edit is saved over it (newer clock wins); the banner stays until a choice.
    expect(await board.flush()).toBe(true);
    expect((await pulled(id)).firstName).toBe("Local");
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(true);

    board.loadUpdate();
    expect(board.getSnapshot().remote).toBe(false);
    expect(board.getSnapshot().identity.firstName).toBe("Remote");
    expect(await board.flush()).toBe(true);
    expect((await pulled(id)).firstName).toBe("Remote");
    await casualtyRepo.softDelete(id);
  });

  it("keeps the local edit when the medic keeps their edits", async () => {
    const { id, board } = await openWith([]);
    board.editIdentity({ firstName: "Local" });
    await casualtyRepo.updateFields(id, { firstName: "Remote" });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(true);
    board.keepEdits();
    expect(board.getSnapshot().remote).toBe(false);
    expect(await board.flush()).toBe(true);
    expect((await pulled(id)).firstName).toBe("Local");
    await casualtyRepo.softDelete(id);
  });

  it("holds a clinical row edited on both devices until the medic chooses, even when the save finds it first", async () => {
    clearSaveStatus("board");
    const { id, board, rows } = await openWith([60]);
    const row = rows[0]!;
    board.upsertVital({ ...row, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(65), id: row.id });
    expect(await board.flush()).toBe(true);
    // Not written (shared conflict policy): the other value stays stored, the medic's stays on screen.
    expect(board.getSnapshot().remote).toBe(true);
    expect(await storedPulses(id)).toEqual([65]);
    expect(shownPulses(board)).toEqual([61]);
    expect(getSaveStatus().board.invalid).toEqual(["vitals"]);

    board.loadUpdate();
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([65]);
    expect(shownPulses(board)).toEqual([65]);
    expect(board.getSnapshot().remote).toBe(false);
    expect(getSaveStatus().board.invalid).toEqual([]);
    await casualtyRepo.softDelete(id);
  });

  it("saves a held clinical row when the medic keeps their edits", async () => {
    const { id, board, rows } = await openWith([60]);
    const row = rows[0]!;
    board.upsertVital({ ...row, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(65), id: row.id });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(true);
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([65]);

    board.keepEdits();
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([61]);
    expect(board.getSnapshot().remote).toBe(false);
    await casualtyRepo.softDelete(id);
  });

  it("merges a row edited on both devices in different columns (type here, time there)", async () => {
    const { id, board } = await openWith([]);
    board.setLimbTourniquet(Limb.RIGHT_ARM, "CAT", new Date(2026, 9, 1, 10, 5).toISOString());
    expect(await board.flush()).toBe(true);
    const corrected = new Date(2026, 9, 1, 9, 55).toISOString();

    // The save runs first, then the board sees the other device's time correction.
    board.setLimbTourniquet(Limb.RIGHT_ARM, "SOFTT-W");
    await casualtyRepo.upsertChild(id, "tourniquet", { limb: Limb.RIGHT_ARM, type: "CAT", appliedAt: corrected });
    expect(await board.flush()).toBe(true);
    expect(activeTourniquets(await pulled(id))).toEqual([expect.objectContaining({ type: "SOFTT-W", appliedAt: corrected })]);
    expect(board.getSnapshot().remote).toBe(false);

    // The board sees the correction first, while its own type edit is unsaved.
    const later = new Date(2026, 9, 1, 9, 50).toISOString();
    board.setLimbTourniquet(Limb.RIGHT_ARM, "SAM-XT");
    await casualtyRepo.upsertChild(id, "tourniquet", { limb: Limb.RIGHT_ARM, type: "SOFTT-W", appliedAt: later });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(false);
    expect(board.getSnapshot().tourniquets).toEqual([expect.objectContaining({ type: "SAM-XT", appliedAt: later })]);
    expect(await board.flush()).toBe(true);
    expect(activeTourniquets(await pulled(id))).toEqual([expect.objectContaining({ type: "SAM-XT", appliedAt: later })]);
    await casualtyRepo.softDelete(id);
  });

  it("holds an allergy edited on both devices and lists it as not saved", async () => {
    clearSaveStatus("board");
    const { id, board } = await openWith([]);
    board.editIdentity({ allergies: "PENICILLIN", firstName: "Ivan" });
    await casualtyRepo.updateFields(id, { allergies: "NKDA" });
    expect(await board.flush()).toBe(true);
    const card = await pulled(id);
    expect(card.allergies).toBe("NKDA");
    expect(card.firstName).toBe("Ivan");
    expect(board.getSnapshot().remote).toBe(true);
    expect(getSaveStatus().board.invalid).toEqual(["allergies"]);

    board.keepEdits();
    expect(await board.flush()).toBe(true);
    expect((await pulled(id)).allergies).toBe("PENICILLIN");
    expect(getSaveStatus().board.invalid).toEqual([]);
    await casualtyRepo.softDelete(id);
  });

  it("loads the newest version when the other device changes a clashing value again", async () => {
    const { id, board, rows } = await openWith([60]);
    const row = rows[0]!;
    board.upsertVital({ ...row, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(65), id: row.id });
    board.hydrate(await pulled(id));
    await board.flush();
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(66), id: row.id });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(true);
    board.loadUpdate();
    expect(await board.flush()).toBe(true);
    expect(await storedPulses(id)).toEqual([66]);

    // A saved field the other device then replaces again: its newer value shows, and the clash is over.
    board.editIdentity({ firstName: "Local" });
    await casualtyRepo.updateFields(id, { firstName: "Remote" });
    board.hydrate(await pulled(id));
    await board.flush();
    expect((await pulled(id)).firstName).toBe("Local");
    await casualtyRepo.updateFields(id, { firstName: "Remote2" });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().identity.firstName).toBe("Remote2");
    expect(board.getSnapshot().remote).toBe(false);
    await casualtyRepo.softDelete(id);
  });

  it("keeps another device's row drafts next to the unsaved ones", async () => {
    const { id, board, rows } = await openWith([60, 70]);
    const [first, second] = rows as [LocalCasualtyCard["vitalSigns"][number], LocalCasualtyCard["vitalSigns"][number]];
    board.editRowDrafts({ [first.id]: { time: "09" } });
    await casualtyRepo.updateFields(id, { rowDrafts: { [second.id]: { time: "14" } } });
    expect(await board.flush()).toBe(true);
    expect((await pulled(id)).rowDrafts).toEqual({ [first.id]: { time: "09" }, [second.id]: { time: "14" } });

    board.editRowDrafts({ ...board.getSnapshot().rowDrafts, [first.id]: { time: "090" } });
    await casualtyRepo.updateFields(id, { rowDrafts: { [first.id]: { time: "09" }, [second.id]: { time: "145" } } });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().rowDrafts).toEqual({ [first.id]: { time: "090" }, [second.id]: { time: "145" } });
    expect(await board.flush()).toBe(true);
    expect((await pulled(id)).rowDrafts).toEqual({ [first.id]: { time: "090" }, [second.id]: { time: "145" } });
    await casualtyRepo.softDelete(id);
  });

  it("does not write a held row from a save queued before the clash was found", async () => {
    const { id, board, rows } = await openWith([60, 70]);
    const [row, other] = rows as [LocalCasualtyCard["vitalSigns"][number], LocalCasualtyCard["vitalSigns"][number]];
    board.upsertVital({ ...row, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(65), id: row.id });
    const first = board.flush();
    // Another instant edit while the first save runs queues a second save, built before the clash is known.
    board.removeVital(other.id);
    await first;
    await board.flush();
    expect(await storedPulses(id)).toEqual([65]);
    expect(board.getSnapshot().remote).toBe(true);
    expect(shownPulses(board)).toEqual([61]);
    await casualtyRepo.softDelete(id);
  });

  it("ends a held clash when a save finds the other device now agrees", async () => {
    const { id, board, rows } = await openWith([60]);
    const row = rows[0]!;
    board.upsertVital({ ...row, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(65), id: row.id });
    board.hydrate(await pulled(id));
    expect(board.getSnapshot().remote).toBe(true);

    // Without a hydrate, the other device changes its value to the medic's while a save of another section runs.
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(61), id: row.id });
    board.editNotes("pulse checked");
    expect(await board.flush()).toBe(true);
    expect(board.getSnapshot().remote).toBe(false);
    board.loadUpdate();
    await board.flush();
    expect(await storedPulses(id)).toEqual([61]);
    await casualtyRepo.softDelete(id);
  });

  it("shows another device's change to an unedited column once the save finds it", async () => {
    const { id, board, rows } = await openWith([60]);
    const row = rows[0]!;
    board.upsertVital({ ...row, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(60), spo2: 91, id: row.id });
    expect(await board.flush()).toBe(true);
    // The board has not seen the pulled card yet; it must not keep showing the old SpO2.
    expect(board.getSnapshot().vitals).toEqual([expect.objectContaining({ pulseRate: 61, spo2: 91 })]);
    expect(board.getSnapshot().remote).toBe(false);
    await casualtyRepo.softDelete(id);
  });

  it("keeps the store of a closed card while a held edit waits for a choice", async () => {
    const { id, board, rows } = await openWith([60]);
    board.upsertVital({ ...rows[0]!, pulseRate: 61 });
    await casualtyRepo.upsertChild(id, "vitalSigns", { ...vitalInput(65), id: rows[0]!.id });
    await board.flush();
    mounted = mounted.filter((store) => store !== board);
    releaseBoard(board);
    await flushAllBoards();
    expect(liveBoards().has(board)).toBe(true);
    expect(boardForCard(await pulled(id))).toBe(board);
    board.keepEdits();
    await board.flush();
    expect(await storedPulses(id)).toEqual([61]);
    await casualtyRepo.softDelete(id);
  });

  it("does not resend saved fields while another field is held (P1-003 b)", async () => {
    const { id, board } = await openWith([]);
    board.editIdentity({ lastName: "Local", casualtyLast4: "12" });
    board.editNotes("local note");
    await board.flush();
    expect((await pulled(id)).lastName).toBe("Local");
    expect((await pulled(id)).notes).toBe("local note");

    await casualtyRepo.updateFields(id, { lastName: "Remote", notes: "remote note" });
    board.editIdentity({ casualtyLast4: "123" });
    await board.flush();
    const card = await pulled(id);
    expect(card.lastName).toBe("Remote");
    expect(card.notes).toBe("remote note");
    board.hydrate(card);
    expect(board.getSnapshot().identity.lastName).toBe("Remote");
    expect(board.getSnapshot().notes).toBe("remote note");
    expect(board.getSnapshot().identity.casualtyLast4).toBe("123");
    await casualtyRepo.softDelete(id);
  });
});

describe("commitBoard", () => {
  it("rolls back a stale field write", async () => {
    const card = await repo.create({ lastName: "Adler" });
    let checks = 0;
    const draftSnapshot = emptySnapshot(card.id);
    draftSnapshot.identity = { ...draftSnapshot.identity, lastName: "Berg" };
    const edits = { patch: { lastName: "Berg" }, rows: emptyPendingRows(), drafts: new Set<string>() };
    const outcome = await commitBoard(repo, card.id, draftSnapshot, new Set(["identity"]), edits, null, null, () => ++checks <= 2);
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
    const draftSnapshot = emptySnapshot(card.id);
    draftSnapshot.vitals = [{ ...vital, pulseRate: 111 }];
    const pending = emptyPendingRows();
    pending.vitals.changed.set(vital.id, new Set(["pulseRate"]));
    const edits = { patch: {}, rows: pending, drafts: new Set<string>() };
    const outcome = await commitBoard(repo, card.id, draftSnapshot, new Set(["vitals"]), edits, null, null, () => true);
    expect(outcome.status).toBe("saved");
    const fresh = await repo.getById(card.id);
    const rows = fresh!.vitalSigns.filter((row) => row.deletedAt == null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(vital.id);
    expect(rows[0]?.pulseRate).toBe(111);
  });
});
