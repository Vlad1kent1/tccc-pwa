import type { CardField } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import type { OutboxMutation } from "@/lib/db";
import { coalesceOutbox } from "./coalesce";

const CARD = "01999999-9999-7000-8000-000000000001";
const OTHER = "01999999-9999-7000-8000-000000000002";
const TOURNIQUET = "01999999-9999-7000-8000-000000000003";

function hlc(counter: number): string {
  return `1790000000000:${String(counter).padStart(4, "0")}:device`;
}

function upsert(
  seq: number,
  patch: Record<string, unknown>,
  counter: number,
  extra: Partial<OutboxMutation> = {},
): OutboxMutation {
  return {
    seq,
    op: "card.upsert",
    mutationId: `01999999-9999-7000-8000-0000000000${seq}${seq}`,
    cardId: CARD,
    hlc: hlc(counter),
    baseVersion: 1,
    patch,
    changedFields: Object.keys(patch) as CardField[],
    status: "queued",
    attempts: 0,
    createdAt: seq,
    ...extra,
  } as OutboxMutation;
}

describe("coalesceOutbox", () => {
  it("lets the highest HLC win each field and keeps that edit's own clock", () => {
    const first = upsert(1, { lastName: "Early", evacPriority: "ROUTINE" }, 1);
    const second = upsert(2, { evacPriority: "URGENT", allergies: "penicillin" }, 3);
    const skewed = upsert(3, { lastName: "Stale" }, 0);

    const { mutations, deleteSeqs } = coalesceOutbox([first, second, skewed]);

    // lastName was last written at hlc(1); sending it under hlc(3) would let it beat a newer remote edit.
    expect(mutations).toEqual([
      expect.objectContaining({ seq: 1, hlc: hlc(1), patch: { lastName: "Early" }, changedFields: ["lastName"], baseVersion: 1 }),
      expect.objectContaining({
        seq: 2,
        hlc: hlc(3),
        patch: { evacPriority: "URGENT", allergies: "penicillin" },
        changedFields: ["evacPriority", "allergies"],
        baseVersion: 1,
      }),
    ]);
    expect(deleteSeqs).toEqual([3]);
  });

  it("collapses repeated edits of one field into the newest", () => {
    const typed = [upsert(1, { notes: "T" }, 1), upsert(2, { notes: "TQ" }, 2), upsert(3, { notes: "TQ R arm" }, 3)];
    const { mutations, deleteSeqs } = coalesceOutbox(typed);
    expect(mutations).toEqual([expect.objectContaining({ seq: 1, hlc: hlc(3), patch: { notes: "TQ R arm" } })]);
    expect(deleteSeqs.sort()).toEqual([2, 3]);
  });

  it("sends the card before its child rows even when every field was edited again later", () => {
    const create = upsert(1, { lastName: "A" }, 1, { baseVersion: null });
    const vital: OutboxMutation = {
      seq: 2,
      op: "child.upsert",
      entity: "vitalSigns",
      row: {
        id: TOURNIQUET,
        cardId: CARD,
        measuredAt: "2026-09-23T12:00:00.000Z",
        pulseRate: 90,
        pulseLocation: null,
        systolic: null,
        diastolic: null,
        respiratoryRate: null,
        spo2: null,
        avpu: null,
        painScale: null,
        clientUpdatedAt: hlc(2),
        deletedAt: null,
      },
      mutationId: "01999999-9999-7000-8000-000000000013",
      cardId: CARD,
      hlc: hlc(2),
      baseVersion: null,
      status: "queued",
      attempts: 0,
      createdAt: 2,
    };
    const rename = upsert(3, { lastName: "B" }, 3, { baseVersion: null });

    const { mutations, deleteSeqs } = coalesceOutbox([create, vital, rename]);
    expect(mutations.map((entry) => [entry.seq, entry.op])).toEqual([
      [1, "card.upsert"],
      [2, "child.upsert"],
    ]);
    expect(mutations[0]).toMatchObject({ mutationId: rename.mutationId, hlc: hlc(3), patch: { lastName: "B" } });
    expect(deleteSeqs).toEqual([3]);
  });

  it("keeps different cards and child entities apart", () => {
    const card = upsert(1, { notes: "a" }, 1);
    const other = upsert(2, { notes: "b" }, 1, { cardId: OTHER });
    const child: OutboxMutation = {
      seq: 3,
      op: "child.upsert",
      entity: "tourniquet",
      row: {
        id: TOURNIQUET,
        cardId: CARD,
        limb: "RIGHT_ARM",
        type: "CAT",
        appliedAt: "2026-09-23T12:00:00.000Z",
        clientUpdatedAt: hlc(4),
        deletedAt: null,
      },
      mutationId: "01999999-9999-7000-8000-000000000010",
      cardId: CARD,
      hlc: hlc(4),
      baseVersion: 1,
      status: "queued",
      attempts: 0,
      createdAt: 3,
    };

    const { mutations } = coalesceOutbox([card, other, child]);
    expect(mutations.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("collapses a child upsert followed by a newer delete into the delete", () => {
    const upsertChild: OutboxMutation = {
      seq: 1,
      op: "child.upsert",
      entity: "tourniquet",
      row: {
        id: TOURNIQUET,
        cardId: CARD,
        limb: "RIGHT_ARM",
        type: "CAT",
        appliedAt: "2026-09-23T12:00:00.000Z",
        clientUpdatedAt: hlc(1),
        deletedAt: null,
      },
      mutationId: "01999999-9999-7000-8000-000000000011",
      cardId: CARD,
      hlc: hlc(1),
      baseVersion: 1,
      status: "queued",
      attempts: 0,
      createdAt: 1,
    };
    const deletion: OutboxMutation = {
      seq: 2,
      op: "child.delete",
      entity: "tourniquet",
      entityId: TOURNIQUET,
      deletedAt: "2026-09-23T12:05:00.000Z",
      mutationId: "01999999-9999-7000-8000-000000000012",
      cardId: CARD,
      hlc: hlc(2),
      baseVersion: 1,
      status: "queued",
      attempts: 0,
      createdAt: 2,
    };

    const { mutations, deleteSeqs } = coalesceOutbox([upsertChild, deletion]);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ op: "child.delete", seq: 1, hlc: hlc(2) });
    expect(deleteSeqs).toEqual([2]);
  });

  it("does not merge failed mutations", () => {
    const failed = upsert(1, { notes: "keep" }, 1, { status: "failed" });
    const queued = upsert(2, { notes: "next" }, 2);
    const { mutations, deleteSeqs } = coalesceOutbox([failed, queued]);
    expect(mutations).toEqual([queued]);
    expect(deleteSeqs).toEqual([]);
  });
});
