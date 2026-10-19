import { emptyCardFields, tourniquetId, type CasualtyCard } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import type { LocalCasualtyCard, OutboxMutation } from "@/lib/db";
import { rebaseCard, sameCardContent } from "./rebase";

const CARD = "01999999-9999-7000-8000-000000000001";
const VITAL = "01999999-9999-7000-8000-0000000000a1";
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
    expect(local.active).toBe(1);
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

  it("does not replay a queued edit that is older than the server's value", () => {
    const queued: OutboxMutation = {
      seq: 9,
      op: "card.upsert",
      mutationId: "01999999-9999-7000-8000-000000000023",
      cardId: CARD,
      hlc: hlc(0),
      baseVersion: 4,
      patch: { evacPriority: "URGENT" },
      changedFields: ["evacPriority"],
      status: "queued",
      attempts: 0,
      createdAt: 9,
    };
    const local = rebaseCard(serverCard(), [queued], "pending");
    expect(local.evacPriority).toBe("ROUTINE");
    expect(local.fieldClock.evacPriority).toBe(hlc(1));
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

describe("pulled injury sites", () => {
  it("moves a site code that a not-yet-updated device wrote into the description", () => {
    const row = {
      id: VITAL,
      cardId: CARD,
      region: "RIGHT_ARM" as const,
      view: "FRONT" as const,
      x: 0.2,
      y: 0.2,
      siteCode: null,
      description: "Ant_Right_Shoulder",
      clientUpdatedAt: hlc(2),
      deletedAt: null,
    };
    const local = rebaseCard(serverCard({ injurySites: [row, { ...row, id: CARD, description: "shrapnel" }] }), [], "synced");
    expect(local.injurySites.map(({ siteCode, description }) => ({ siteCode, description }))).toEqual([
      { siteCode: "Ant_Right_Shoulder", description: null },
      { siteCode: null, description: "shrapnel" },
    ]);
  });
});

describe("rebaseCard merging into the stored card", () => {
  const OTHER = "01999999-9999-7000-8000-0000000000bb";
  const otherHlc = (counter: number) => `1790000000000:${String(counter).padStart(4, "0")}:${OTHER}`;

  function stored(overrides: Partial<LocalCasualtyCard> = {}): LocalCasualtyCard {
    return { ...rebaseCard(serverCard(), [], "synced"), clientUpdatedAt: hlc(9), ...overrides };
  }

  function vital(id: string, pulseRate: number, clock: string, deletedAt: string | null = null) {
    return {
      id,
      cardId: CARD,
      measuredAt: "2026-09-23T12:05:00.000Z",
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

  it("applies another device's row even though this device edited the card more recently", () => {
    const local = stored({ notes: "mine", fieldClock: { lastName: hlc(1), evacPriority: hlc(1), notes: hlc(9) } });
    const fromOther = serverCard({ vitalSigns: [vital(VITAL, 112, otherHlc(3))], version: 5 });

    const merged = rebaseCard(fromOther, [], "synced", local);

    expect(merged.vitalSigns).toEqual([expect.objectContaining({ id: VITAL, pulseRate: 112 })]);
    expect(merged.notes).toBe("mine");
    expect(merged.serverVersion).toBe(5);
    expect(sameCardContent(merged, local)).toBe(false);
  });

  it("keeps each field from whichever side wrote it last", () => {
    const local = stored({
      lastName: "Local",
      allergies: "NKA",
      fieldClock: { lastName: hlc(7), evacPriority: hlc(1), allergies: hlc(2) },
    });
    const server = serverCard({
      lastName: "Older",
      allergies: "Penicillin",
      fieldClock: { lastName: otherHlc(5), evacPriority: hlc(1), allergies: otherHlc(4) },
    });

    const merged = rebaseCard(server, [], "synced", local);

    expect(merged).toMatchObject({ lastName: "Local", allergies: "Penicillin" });
    expect(merged.fieldClock).toMatchObject({ lastName: hlc(7), allergies: otherHlc(4) });
  });

  it("keeps a row the server does not have yet, but not a local tombstone of one", () => {
    const pending = vital("01999999-9999-7000-8000-0000000000c1", 80, hlc(8));
    const gone = vital("01999999-9999-7000-8000-0000000000c2", 70, hlc(8), "2026-09-23T12:30:00.000Z");
    const merged = rebaseCard(serverCard(), [], "pending", stored({ vitalSigns: [pending, gone] }));
    expect(merged.vitalSigns.map((row) => row.id)).toEqual([pending.id]);
  });

  it("keeps a newer local deletion over the server's older live row, and takes a newer server deletion", () => {
    const deletedLocally = vital(VITAL, 90, hlc(8), "2026-09-23T12:30:00.000Z");
    const keptDeleted = rebaseCard(
      serverCard({ vitalSigns: [vital(VITAL, 90, otherHlc(4))] }),
      [],
      "pending",
      stored({ vitalSigns: [deletedLocally] }),
    );
    expect(keptDeleted.vitalSigns[0]).toMatchObject({ deletedAt: "2026-09-23T12:30:00.000Z" });

    const deletedRemotely = rebaseCard(
      serverCard({ vitalSigns: [vital(VITAL, 90, otherHlc(9), "2026-09-23T12:40:00.000Z")] }),
      [],
      "synced",
      stored({ vitalSigns: [vital(VITAL, 90, hlc(3))] }),
    );
    expect(deletedRemotely.vitalSigns[0]).toMatchObject({ deletedAt: "2026-09-23T12:40:00.000Z" });
  });

  it("does not let an older server snapshot undo newer values", () => {
    const local = stored({ lastName: "Newest", fieldClock: { lastName: otherHlc(8), evacPriority: hlc(1) } });
    const merged = rebaseCard(serverCard({ lastName: "Older", version: 3 }), [], "synced", local);
    expect(merged.lastName).toBe("Newest");
    expect(sameCardContent(merged, local)).toBe(true);
  });

  it("keeps the stored clientUpdatedAt for the caller to re-stamp", () => {
    const merged = rebaseCard(serverCard({ lastName: "Changed", fieldClock: { lastName: otherHlc(5) } }), [], "synced", stored());
    expect(merged.lastName).toBe("Changed");
    expect(merged.clientUpdatedAt).toBe(hlc(9));
  });
});
