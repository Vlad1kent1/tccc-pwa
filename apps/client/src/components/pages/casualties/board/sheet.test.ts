import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { FluidKind, Limb, Route, newId } from "@tccc/shared";
import { casualtyRepo, db as appDb, type LocalCasualtyCard } from "@/lib/db";
import { clearSaveStatus, getSaveStatus } from "@/lib/forms/save-status";
import { saveVitalSlot } from "@/components/pages/casualties/board/rows";
import { applySheetChange, sheetValues } from "@/components/pages/casualties/board/sheet";
import { boardForCard, flushAllBoards, releaseBoard, retainBoard, type BoardStore } from "@/components/pages/casualties/board/store";

let mounted: BoardStore[] = [];
let created: string[] = [];

async function cardWith(fields: Parameters<typeof casualtyRepo.create>[0]): Promise<LocalCasualtyCard> {
  const card = await casualtyRepo.create(fields);
  created.push(card.id);
  return card;
}

async function openSheet(cardId: string): Promise<BoardStore> {
  const card = (await casualtyRepo.getById(cardId))!;
  const store = boardForCard(card);
  retainBoard(store);
  mounted.push(store);
  store.hydrate(card);
  return store;
}

async function stored(cardId: string): Promise<LocalCasualtyCard> {
  return (await casualtyRepo.getById(cardId))!;
}

beforeEach(() => {
  clearSaveStatus("board");
});

afterEach(async () => {
  for (const store of mounted) releaseBoard(store);
  mounted = [];
  await flushAllBoards();
  for (const id of created) await casualtyRepo.softDelete(id);
  created = [];
});

afterAll(() => {
  appDb.close();
});

describe("DD1380 sheet on the board store", () => {
  it("does not rewrite a tourniquet whose time reads back as the same minute", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const appliedAt = new Date(2026, 9, 1, 8, 15, 42, 517).toISOString();
    await casualtyRepo.upsertChild(card.id, "tourniquet", { limb: Limb.LEFT_LEG, type: "CAT", appliedAt });
    const sheet = await openSheet(card.id);
    const before = await appDb.outbox.where("cardId").equals(card.id).count();

    applySheetChange(sheet, { notes: "x" });
    applySheetChange(sheet, { l_leg_time: "0815" });
    await sheet.flush();

    expect((await stored(card.id)).tourniquets.find((row) => row.limb === Limb.LEFT_LEG)?.appliedAt).toBe(appliedAt);
    const queued = await appDb.outbox.where("cardId").equals(card.id).toArray();
    expect(queued.slice(before).some((entry) => entry.op === "child.upsert")).toBe(false);
  });

  it("keeps the stored tourniquet time while the time box is blank or unfinished", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const appliedAt = new Date(2026, 9, 1, 8, 15).toISOString();
    await casualtyRepo.upsertChild(card.id, "tourniquet", { limb: Limb.LEFT_LEG, type: "CAT", appliedAt });
    const sheet = await openSheet(card.id);

    for (const time of ["", "08"]) {
      applySheetChange(sheet, { l_leg_time: time });
      await sheet.flush();
      expect((await stored(card.id)).tourniquets.find((row) => row.limb === Limb.LEFT_LEG)?.appliedAt).toBe(appliedAt);
      expect(sheetValues(sheet.getSnapshot()).l_leg_time).toBe(time);
    }
  });

  it("leaves a multi-word last name alone when another field changes, and splits on a comma", async () => {
    const card = await cardWith({ lastName: "Van Damme" });
    const sheet = await openSheet(card.id);
    expect(sheetValues(sheet.getSnapshot()).name).toBe("Van Damme");

    applySheetChange(sheet, { notes: "pelvic binder" });
    await sheet.flush();
    expect(await stored(card.id)).toMatchObject({ lastName: "Van Damme", firstName: null, notes: "pelvic binder" });

    applySheetChange(sheet, { name: "Van Damme, Jean " });
    await sheet.flush();
    expect(await stored(card.id)).toMatchObject({ lastName: "Van Damme", firstName: "Jean" });
    expect(sheetValues(sheet.getSnapshot()).name).toBe("Van Damme, Jean ");
  });

  it("keeps an injury date without a time on screen and saves it once the time is typed", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const sheet = await openSheet(card.id);

    applySheetChange(sheet, { date: "01-OCT-26" });
    await sheet.flush();
    expect((await stored(card.id)).injuredAt).toBeNull();
    expect(sheetValues(sheet.getSnapshot()).date).toBe("01-OCT-26");

    applySheetChange(sheet, { time: "0830" });
    await sheet.flush();
    expect((await stored(card.id)).injuredAt).toBe(new Date(2026, 9, 1, 8, 30).toISOString());
  });

  it("saves valid fields and reports an invalid one instead of rolling back", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const sheet = await openSheet(card.id);
    applySheetChange(sheet, { allergies: "x".repeat(501), notes: "  chest seal applied  " });
    await sheet.flush();

    const fresh = await stored(card.id);
    expect(fresh.notes).toBe("chest seal applied");
    expect(fresh.allergies).toBeNull();
    expect(getSaveStatus().board.invalid).toEqual(["allergies"]);
  });

  it("saves the paper SERVICE, UNIT, and LAST 4 boxes", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const sheet = await openSheet(card.id);
    applySheetChange(sheet, { service: "Army", unit: "1 BN", last4: "04" });
    await sheet.flush();
    expect(await stored(card.id)).toMatchObject({ service: "Army", unit: "1 BN", casualtyLast4: null });

    applySheetChange(sheet, { last4: "0427" });
    await sheet.flush();
    expect((await stored(card.id)).casualtyLast4).toBe("0427");
  });

  it("marks and clears a paper injury site without touching a figure mark", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const markId = newId();
    await casualtyRepo.upsertChild(card.id, "injurySite", {
      id: markId,
      region: "CHEST",
      view: "FRONT",
      x: 0.42,
      y: 0.33,
      siteCode: null,
      description: null,
    });
    const sheet = await openSheet(card.id);
    const site = "Ant_Right_Shoulder";

    applySheetChange(sheet, { [site]: true });
    await sheet.flush();
    let live = (await stored(card.id)).injurySites.filter((row) => row.deletedAt == null);
    expect(live).toHaveLength(2);
    expect(live.find((row) => row.id === markId)).toMatchObject({ siteCode: null, description: null });
    expect(live.find((row) => row.id !== markId)).toMatchObject({ siteCode: site, description: null });

    applySheetChange(sheet, { [site]: false });
    await sheet.flush();
    live = (await stored(card.id)).injurySites.filter((row) => row.deletedAt == null);
    expect(live.map((row) => row.id)).toEqual([markId]);
  });

  it("keeps rows that do not fit on the paper card", async () => {
    const card = await cardWith({ lastName: "Adler" });
    for (let i = 0; i < 5; i++) {
      await casualtyRepo.upsertChild(card.id, "vitalSigns", vital(new Date(2026, 9, 1, 8, i).toISOString(), 60 + i));
    }
    for (let i = 0; i < 3; i++) {
      await casualtyRepo.upsertChild(card.id, "fluid", {
        id: newId(),
        kind: FluidKind.FLUID,
        name: `Fluid ${i + 1}`,
        volumeMl: 100 * (i + 1),
        route: Route.IV,
        administeredAt: new Date(2026, 9, 1, 9, i).toISOString(),
      });
    }
    const sheet = await openSheet(card.id);
    applySheetChange(sheet, { notes: "re-checked" });
    await sheet.flush();

    const fresh = await stored(card.id);
    expect(fresh.vitalSigns.filter((row) => row.deletedAt == null)).toHaveLength(5);
    expect(fresh.fluids.filter((row) => row.deletedAt == null)).toHaveLength(3);
  });

  it("saves sheet fields and paper table cells through one store and one write", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const sheet = await openSheet(card.id);
    const before = await appDb.outbox.where("cardId").equals(card.id).count();

    applySheetChange(sheet, { notes: "TXA given" });
    saveVitalSlot(sheet, 0, { pulse: "104" });
    await sheet.flush();

    const fresh = await stored(card.id);
    expect(fresh.notes).toBe("TXA given");
    expect(fresh.vitalSigns.filter((row) => row.deletedAt == null).map((row) => row.pulseRate)).toEqual([104]);
    const queued = (await appDb.outbox.where("cardId").equals(card.id).toArray()).slice(before);
    expect(queued.filter((entry) => entry.op === "card.upsert")).toHaveLength(1);
  });

  it("drops typed text that a newer stored value has replaced", async () => {
    const card = await cardWith({ lastName: "Adler" });
    const sheet = await openSheet(card.id);
    applySheetChange(sheet, { name: "Adler " });
    expect(sheetValues(sheet.getSnapshot()).name).toBe("Adler ");

    sheet.hydrate(await casualtyRepo.updateFields(card.id, { lastName: "Berg" }));
    expect(sheetValues(sheet.getSnapshot()).name).toBe("Berg");
  });
});

function vital(measuredAt: string, pulseRate: number) {
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
