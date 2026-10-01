import { emptyCardFields, tourniquetId, type CasualtyCard } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import type { OutboxMutation } from "@/lib/db";
import { rebaseCard } from "./rebase";

const CARD = "01999999-9999-7000-8000-000000000001";
const DEVICE = "01999999-9999-7000-8000-000000000099";

function hlc(counter: number): string {
  return `1790000000000:${String(counter).padStart(4, "0")}:${DEVICE}`;
}

function serverCard(overrides: Partial<CasualtyCard> = {}): CasualtyCard {
  return {
    id: CARD,
    ...emptyCardFields(),
    lastName: "Server",
    evacPriority: "ROUTINE",
    injurySites: [],
    tourniquets: [
      {
        id: tourniquetId(CARD, "RIGHT_ARM"),
        cardId: CARD,
        limb: "RIGHT_ARM",
        type: "CAT",
        appliedAt: "2026-09-23T12:00:00.000Z",
        clientUpdatedAt: hlc(1),
        deletedAt: null,
      },
    ],
    vitalSigns: [],
    fluids: [],
    medications: [],
    fieldClock: { lastName: hlc(1), evacPriority: hlc(1) },
    version: 4,
    changeSeq: "40",
    createdByDeviceId: DEVICE,
    createdAt: "2026-09-23T12:00:00.000Z",
    serverUpdatedAt: "2026-09-23T12:10:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("rebaseCard", () => {
  it("replaces the local card with the server aggregate when nothing is queued", () => {
    const local = rebaseCard(serverCard(), [], "synced");
    expect(local.serverVersion).toBe(4);
    expect(local.lastName).toBe("Server");
    expect(local.syncStatus).toBe("synced");
    expect(local.changeSeq).toBe("40");
    expect(local.tourniquets).toHaveLength(1);
  });

  it("replays queued field patches on top of the server aggregate", () => {
    const queued: OutboxMutation = {
      seq: 7,
      op: "card.upsert",
      mutationId: "01999999-9999-7000-8000-000000000021",
      cardId: CARD,
      hlc: hlc(5),
      baseVersion: 4,
      patch: { evacPriority: "URGENT" },
      changedFields: ["evacPriority"],
      status: "queued",
      attempts: 0,
      createdAt: 7,
    };

    const local = rebaseCard(serverCard(), [queued], "pending");
    expect(local.lastName).toBe("Server");
    expect(local.evacPriority).toBe("URGENT");
    expect(local.fieldClock.evacPriority).toBe(hlc(5));
    expect(local.syncStatus).toBe("pending");
    expect(local.serverVersion).toBe(4);
  });

  it("tombstones a server child when a queued delete is still outstanding", () => {
    const entityId = tourniquetId(CARD, "RIGHT_ARM");
    const queued: OutboxMutation = {
      seq: 8,
      op: "child.delete",
      entity: "tourniquet",
      entityId,
      deletedAt: "2026-09-23T12:20:00.000Z",
      mutationId: "01999999-9999-7000-8000-000000000022",
      cardId: CARD,
      hlc: hlc(6),
      baseVersion: 4,
      status: "queued",
      attempts: 0,
      createdAt: 8,
    };

    const local = rebaseCard(serverCard(), [queued], "pending");
    expect(local.tourniquets[0]).toMatchObject({ id: entityId, deletedAt: "2026-09-23T12:20:00.000Z" });
  });
});
