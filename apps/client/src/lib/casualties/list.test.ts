import { formatHlc } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import { listCasualties, type ListCard } from "./list";

function card(partial: Partial<ListCard> & Pick<ListCard, "evacPriority" | "clientUpdatedAt">): ListCard {
  return {
    syncStatus: "pending",
    lastName: null,
    firstName: null,
    battleRosterNumber: null,
    deletedAt: null,
    ...partial,
  };
}

const hlc = (wallTime: number) => formatHlc({ wallTime, counter: 0, nodeId: "node" });

const open = { priority: "all" as const, sync: "all" as const, query: "" };

describe("listCasualties", () => {
  it("sorts urgent, then priority, then routine, then unset, newest first within a rank", () => {
    const cards = [
      card({ evacPriority: "ROUTINE", clientUpdatedAt: hlc(300), lastName: "Routine new" }),
      card({ evacPriority: null, clientUpdatedAt: hlc(900), lastName: "Unset" }),
      card({ evacPriority: "URGENT", clientUpdatedAt: hlc(100), lastName: "Urgent old" }),
      card({ evacPriority: "PRIORITY", clientUpdatedAt: hlc(200), lastName: "Priority" }),
      card({ evacPriority: "URGENT", clientUpdatedAt: hlc(400), lastName: "Urgent new" }),
      card({ evacPriority: "ROUTINE", clientUpdatedAt: hlc(50), lastName: "Routine old" }),
    ];

    expect(listCasualties(cards, open).map((item) => item.lastName)).toEqual([
      "Urgent new",
      "Urgent old",
      "Priority",
      "Routine new",
      "Routine old",
      "Unset",
    ]);
  });

  it("filters by priority, sync status, and name or battle roster number", () => {
    const cards = [
      card({
        evacPriority: "URGENT",
        clientUpdatedAt: hlc(1),
        lastName: "Koval",
        firstName: "Olena",
        battleRosterNumber: "A12",
        syncStatus: "pending",
      }),
      card({
        evacPriority: "ROUTINE",
        clientUpdatedAt: hlc(2),
        lastName: "Shevchenko",
        battleRosterNumber: "B7",
        syncStatus: "synced",
      }),
      card({
        evacPriority: "URGENT",
        clientUpdatedAt: hlc(3),
        lastName: "Deleted",
        deletedAt: "2026-01-01T00:00:00.000Z",
        syncStatus: "pending",
      }),
    ];

    expect(listCasualties(cards, { ...open, priority: "URGENT" }).map((item) => item.lastName)).toEqual(["Koval"]);
    expect(listCasualties(cards, { ...open, sync: "synced" }).map((item) => item.lastName)).toEqual(["Shevchenko"]);
    expect(listCasualties(cards, { ...open, query: "olena" }).map((item) => item.lastName)).toEqual(["Koval"]);
    expect(listCasualties(cards, { ...open, query: "b7" }).map((item) => item.lastName)).toEqual(["Shevchenko"]);
    expect(listCasualties(cards, { ...open, query: "missing" })).toEqual([]);
  });
});
