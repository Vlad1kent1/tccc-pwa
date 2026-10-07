import { emptyCardFields, formatHlc, newId, type VitalSigns } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import type { LocalCasualtyCard, LocalConflict, OutboxMutation } from "@/lib/db";
import { queuedAfterDecision, restoreDiscarded } from "./conflicts";

const deviceId = "0192f100-0000-7000-8000-00000000000a";
const clock = formatHlc({ wallTime: 1_790_000_000_000, counter: 1, nodeId: deviceId });
const measuredAt = "2026-09-24T12:00:00.000Z";

function card(vital: VitalSigns | null = null): LocalCasualtyCard {
  return {
    id: vital?.cardId ?? newId(),
    ...emptyCardFields(),
    evacPriority: "PRIORITY",
    notes: "from-device",
    injurySites: [],
    tourniquets: [],
    vitalSigns: vital ? [vital] : [],
    fluids: [],
    medications: [],
    fieldClock: {},
    syncStatus: "conflict",
    serverVersion: 3,
    changeSeq: "3",
    createdByDeviceId: deviceId,
    createdAt: measuredAt,
    clientUpdatedAt: clock,
    serverUpdatedAt: measuredAt,
    deletedAt: null,
    active: 1,
  };
}

function vital(cardId: string, id: string, pulseRate: number): VitalSigns {
  return {
    id,
    cardId,
    clientUpdatedAt: clock,
    deletedAt: null,
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

function conflict(cardId: string, entityId: string, discarded: VitalSigns): LocalConflict {
  return {
    id: newId(),
    cardId,
    entity: "vitalSigns",
    entityId,
    field: "row",
    kept: vital(cardId, entityId, 99),
    discarded,
    createdAt: measuredAt,
    resolvedAt: null,
    open: 1,
  };
}

describe("restoreDiscarded", () => {
  it("replaces a vital row by id instead of writing a row property", () => {
    const cardId = newId();
    const vitalId = newId();
    const current = card(vital(cardId, vitalId, 99));
    const discarded = vital(cardId, vitalId, 70);
    const restored = restoreDiscarded(current, conflict(cardId, vitalId, discarded));

    expect(restored.vitalSigns).toHaveLength(1);
    expect(restored.vitalSigns[0]).toMatchObject({ id: vitalId, pulseRate: 70 });
    expect(restored.vitalSigns[0]).not.toHaveProperty("row");
  });

  it("inserts a discarded vital that is missing locally", () => {
    const cardId = newId();
    const vitalId = newId();
    const restored = restoreDiscarded(card(null), conflict(cardId, vitalId, vital(cardId, vitalId, 70)));

    expect(restored.vitalSigns).toEqual([expect.objectContaining({ id: vitalId, cardId, pulseRate: 70 })]);
  });
});

describe("queuedAfterDecision", () => {
  it("strips the conflicting card field and leaves the other queued edits", () => {
    const cardId = newId();
    const vitalId = newId();
    const row = vital(cardId, vitalId, 99);
    const entries: OutboxMutation[] = [
      {
        seq: 1,
        op: "card.upsert",
        mutationId: newId(),
        cardId,
        hlc: clock,
        baseVersion: 2,
        patch: { evacPriority: "URGENT", notes: "still-local" },
        changedFields: ["evacPriority", "notes"],
        status: "queued",
        attempts: 0,
        createdAt: 1,
      },
      {
        seq: 2,
        op: "child.upsert",
        entity: "vitalSigns",
        mutationId: newId(),
        cardId,
        hlc: clock,
        baseVersion: 2,
        row,
        status: "queued",
        attempts: 0,
        createdAt: 2,
      },
    ];
    const decision = queuedAfterDecision(
      entries,
      {
        id: newId(),
        cardId,
        entity: "card",
        entityId: cardId,
        field: "evacPriority",
        kept: "PRIORITY",
        discarded: "URGENT",
        createdAt: measuredAt,
        resolvedAt: null,
        open: 1,
      },
      4,
    );

    expect(decision.dropSeqs).toEqual([]);
    expect(decision.keep).toHaveLength(2);
    expect(decision.keep[0]).toMatchObject({
      baseVersion: 4,
      changedFields: ["notes"],
      patch: { notes: "still-local" },
    });
    expect(decision.keep[1]).toMatchObject({ op: "child.upsert", baseVersion: 4 });
  });

  it("drops a queued vital upsert that targets the resolved row", () => {
    const cardId = newId();
    const vitalId = newId();
    const decision = queuedAfterDecision(
      [
        {
          seq: 7,
          op: "child.upsert",
          entity: "vitalSigns",
          mutationId: newId(),
          cardId,
          hlc: clock,
          baseVersion: 2,
          row: vital(cardId, vitalId, 99),
          status: "queued",
          attempts: 0,
          createdAt: 1,
        },
      ],
      conflict(cardId, vitalId, vital(cardId, vitalId, 70)),
      5,
    );

    expect(decision.keep).toEqual([]);
    expect(decision.dropSeqs).toEqual([7]);
  });
});
