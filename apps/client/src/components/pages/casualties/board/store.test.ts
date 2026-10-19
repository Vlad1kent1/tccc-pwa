import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AirwayTreatment,
  BodyView,
  CirculationTreatment,
  FluidKind,
  MedicationCategory,
  Route,
  newId,
} from "@tccc/shared";
import { casualtyRepo, db as appDb, type LocalCasualtyCard } from "@/lib/db";
import { clearSaveStatus, getSaveStatus, retrySave } from "@/lib/forms/save-status";
import { vitalColumn } from "@/components/pages/casualties/board/paper-layout";
import { paperRow, saveVitalSlot } from "@/components/pages/casualties/board/rows";
import { createCasualtyRepo, type CasualtyRepo } from "@/lib/db/casualtyRepo";
import { TcccDB } from "@/lib/db/schema";
import { commitBoard } from "@/components/pages/casualties/board/commit";
import {
  boardForCard,
  createDraftBoard,
  flushAllBoards,
  liveBoards,
  peekBoard,
  releaseBoard,
  retainBoard,
  type BoardStore,
} from "@/components/pages/casualties/board/store";
import { emptySnapshot } from "@/components/pages/casualties/board/snapshot";

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

describe("commitBoard", () => {
  it("rolls back a stale field write", async () => {
    const card = await repo.create({ lastName: "Adler" });
    let checks = 0;
    const draftSnapshot = emptySnapshot(card.id);
    draftSnapshot.identity = { ...draftSnapshot.identity, lastName: "Berg" };
    const outcome = await commitBoard(repo, card.id, draftSnapshot, new Set(["identity"]), { lastName: "Berg" }, () => ++checks <= 2);
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
    const outcome = await commitBoard(repo, card.id, draftSnapshot, new Set(["vitals"]), {}, () => true);
    expect(outcome.status).toBe("saved");
    const fresh = await repo.getById(card.id);
    const rows = fresh!.vitalSigns.filter((row) => row.deletedAt == null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(vital.id);
    expect(rows[0]?.pulseRate).toBe(111);
  });
});
