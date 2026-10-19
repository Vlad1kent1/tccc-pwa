import { describe, expect, it } from "vitest";
import { FluidKind, MedicationCategory } from "@tccc/shared";
import { fluidColumn, hiddenRows, layoutPaper, pinPaperRow, unpinPaperRow, vitalColumn } from "./index";

function vital(id: string, hour: number) {
  return { id, measuredAt: new Date(2026, 9, 1, hour, 0).toISOString() };
}

const none = { vitals: [], fluids: [], medications: [] };

describe("paper layout", () => {
  it("shows the latest rows that fit, oldest first, when a card is opened", () => {
    const vitals = [vital("e", 12), vital("a", 8), vital("c", 10), vital("b", 9), vital("d", 11)];
    const { slots } = layoutPaper({ ...none, vitals });
    expect([0, 1, 2, 3].map((index) => slots[vitalColumn(index)])).toEqual(["b", "c", "d", "e"]);
  });

  it("keeps each row in its column when its time moves past another row", () => {
    const opened = layoutPaper({ ...none, vitals: [vital("a", 8), vital("b", 9)] });
    const edited = layoutPaper({ ...none, vitals: [vital("a", 12), vital("b", 9)] }, opened);
    expect(edited.slots[vitalColumn(0)]).toBe("a");
    expect(edited.slots[vitalColumn(1)]).toBe("b");
  });

  it("puts a new row into a free column without moving the others", () => {
    const opened = layoutPaper({ ...none, vitals: [vital("a", 8)] });
    const next = layoutPaper({ ...none, vitals: [vital("a", 8), vital("z", 7)] }, opened);
    expect(next.slots[vitalColumn(0)]).toBe("a");
    expect(next.slots[vitalColumn(1)]).toBe("z");
  });

  it("does not pull a hidden older row into a column that was just cleared", () => {
    const vitals = [vital("a", 8), vital("b", 9), vital("c", 10), vital("d", 11), vital("e", 12)];
    const opened = layoutPaper({ ...none, vitals });
    const cleared = unpinPaperRow(opened, "c");
    const next = layoutPaper({ ...none, vitals: vitals.filter((row) => row.id !== "c") }, cleared);
    expect(next.slots[vitalColumn(1)]).toBeUndefined();
    expect(Object.values(next.slots)).not.toContain("a");
  });

  it("keeps a row pinned to the column it was typed into", () => {
    const pinned = pinPaperRow(layoutPaper(none), fluidColumn(FluidKind.FLUID, 1), "new");
    const fluid = { id: "new", kind: FluidKind.FLUID, administeredAt: null };
    const next = layoutPaper({ ...none, fluids: [fluid] }, pinned);
    expect(next.slots[fluidColumn(FluidKind.FLUID, 1)]).toBe("new");
    expect(next.slots[fluidColumn(FluidKind.FLUID, 0)]).toBeUndefined();
  });
});

describe("hiddenRows", () => {
  const analgesic = (id: string, hour: number) => ({
    id,
    category: MedicationCategory.ANALGESIC,
    administeredAt: new Date(2026, 9, 1, hour, 0).toISOString(),
  });

  it("counts the rows a table holds beyond its printed lines", () => {
    const medications = [analgesic("a", 8), analgesic("b", 9), analgesic("c", 10), analgesic("d", 11), analgesic("e", 12)];
    const rows = { ...none, medications };
    const layout = layoutPaper(rows);
    expect(hiddenRows(rows, layout, "analgesic")).toBe(1);
    expect(hiddenRows(rows, layout, "antibiotic")).toBe(0);
  });

  it("counts nothing while every row has a column", () => {
    const rows = { ...none, vitals: [vital("a", 8), vital("b", 9)] };
    expect(hiddenRows(rows, layoutPaper(rows), "vitals")).toBe(0);
  });

  it("counts a row that lost its column to a newer one while the card was open", () => {
    const vitals = [vital("a", 8), vital("b", 9), vital("c", 10), vital("d", 11)];
    const opened = layoutPaper({ ...none, vitals });
    const added = { ...none, vitals: [...vitals, vital("e", 12)] };
    expect(hiddenRows(added, layoutPaper(added, opened), "vitals")).toBe(1);
  });
});
