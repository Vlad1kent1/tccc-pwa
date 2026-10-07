import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { TcccDB } from "./schema";

const openDatabases: Dexie[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.delete()));
});

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
