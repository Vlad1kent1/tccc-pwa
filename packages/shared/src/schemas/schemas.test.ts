import { describe, expect, it } from "vitest";
import { formatHlc } from "../hlc.js";
import { newId, tourniquetId } from "../ids.js";
import {
  cardPatchSchema,
  casualtyCardSchema,
  emptyCardFields,
  sectionASchema,
  sectionHSchema,
  vitalSignsSchema,
  type CasualtyCard,
  type VitalSigns,
} from "./card.js";
import { mutationSchema, pushRequestSchema } from "./sync.js";

const deviceId = newId();
const hlc = formatHlc({ wallTime: Date.now(), counter: 0, nodeId: deviceId });
const now = new Date().toISOString();

function vitals(overrides: Partial<VitalSigns> = {}): VitalSigns {
  return {
    id: newId(),
    cardId: newId(),
    clientUpdatedAt: hlc,
    deletedAt: null,
    measuredAt: now,
    pulseRate: 88,
    pulseLocation: "radial",
    systolic: 120,
    diastolic: 80,
    respiratoryRate: 16,
    spo2: 97,
    avpu: "ALERT",
    painScale: 4,
    ...overrides,
  };
}

function card(overrides: Partial<CasualtyCard> = {}): CasualtyCard {
  const id = newId();
  return {
    id,
    ...emptyCardFields(),
    injurySites: [],
    tourniquets: [],
    vitalSigns: [],
    fluids: [],
    medications: [],
    fieldClock: {},
    version: 1,
    changeSeq: "1",
    createdByDeviceId: deviceId,
    createdAt: now,
    serverUpdatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe("section schemas", () => {
  it("accepts a fully empty section A (clinical fields are never mandatory)", () => {
    const { lastName, firstName, gender, injuredAt, battleRosterNumber, evacPriority, allergies } = emptyCardFields();
    expect(
      sectionASchema.safeParse({ lastName, firstName, gender, injuredAt, battleRosterNumber, evacPriority, allergies })
        .success,
    ).toBe(true);
  });

  it("validates the battle roster number format, including Cyrillic letters", () => {
    expect(cardPatchSchema.safeParse({ battleRosterNumber: "AB1234" }).success).toBe(true);
    expect(cardPatchSchema.safeParse({ battleRosterNumber: "ВК1234" }).success).toBe(true);
    expect(cardPatchSchema.safeParse({ battleRosterNumber: "AB-1234" }).success).toBe(false);
    expect(cardPatchSchema.safeParse({ battleRosterNumber: "A".repeat(21) }).success).toBe(false);
  });

  it("requires exactly four digits for responder last 4", () => {
    expect(sectionHSchema.safeParse({ responderName: "Doe", responderLast4: "1234" }).success).toBe(true);
    expect(sectionHSchema.safeParse({ responderName: "Doe", responderLast4: "123" }).success).toBe(false);
    expect(sectionHSchema.safeParse({ responderName: "Doe", responderLast4: "12a4" }).success).toBe(false);
  });

  it("rejects duplicate and unknown enum values in multi-select sets", () => {
    expect(cardPatchSchema.safeParse({ mechanisms: ["GSW", "IED"] }).success).toBe(true);
    expect(cardPatchSchema.safeParse({ mechanisms: ["GSW", "GSW"] }).success).toBe(false);
    expect(cardPatchSchema.safeParse({ airway: ["TELEPORT"] }).success).toBe(false);
  });

  it("rejects unknown fields in a patch", () => {
    expect(cardPatchSchema.safeParse({ version: 7 }).success).toBe(false);
  });
});

describe("vital signs", () => {
  it("accepts a valid measurement set", () => {
    expect(vitalSignsSchema.safeParse(vitals()).success).toBe(true);
  });

  it.each([
    ["painScale", 11],
    ["painScale", -1],
    ["spo2", 101],
    ["pulseRate", 301],
    ["respiratoryRate", 81],
    ["painScale", 4.5],
  ] as const)("rejects %s = %s", (field, value) => {
    expect(vitalSignsSchema.safeParse(vitals({ [field]: value })).success).toBe(false);
  });

  it("requires at least one measurement", () => {
    const empty = vitals({
      pulseRate: null,
      pulseLocation: null,
      systolic: null,
      diastolic: null,
      respiratoryRate: null,
      spo2: null,
      avpu: null,
      painScale: null,
    });
    expect(vitalSignsSchema.safeParse(empty).success).toBe(false);
    expect(vitalSignsSchema.safeParse({ ...empty, avpu: "PAIN" }).success).toBe(true);
  });

  it("rejects systolic lower than diastolic", () => {
    expect(vitalSignsSchema.safeParse(vitals({ systolic: 70, diastolic: 90 })).success).toBe(false);
  });
});

describe("card aggregate", () => {
  it("accepts a valid card", () => {
    expect(casualtyCardSchema.safeParse(card()).success).toBe(true);
  });

  it("rejects two tourniquets on the same limb", () => {
    const c = card();
    const tq = {
      id: tourniquetId(c.id, "LEFT_ARM"),
      cardId: c.id,
      limb: "LEFT_ARM" as const,
      type: "CAT",
      appliedAt: now,
      clientUpdatedAt: hlc,
      deletedAt: null,
    };
    expect(casualtyCardSchema.safeParse({ ...c, tourniquets: [tq, { ...tq, id: newId() }] }).success).toBe(false);
  });
});

describe("sync mutations", () => {
  const base = { mutationId: newId(), cardId: newId(), hlc, baseVersion: null };

  it("accepts a card upsert whose changedFields match the patch", () => {
    const result = mutationSchema.safeParse({
      ...base,
      op: "card.upsert",
      patch: { evacPriority: "URGENT", allergies: "NKA" },
      changedFields: ["evacPriority", "allergies"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a card upsert whose changedFields do not match the patch", () => {
    const result = mutationSchema.safeParse({
      ...base,
      op: "card.upsert",
      patch: { evacPriority: "URGENT" },
      changedFields: ["evacPriority", "notes"],
    });
    expect(result.success).toBe(false);
  });

  it("validates the row of a child upsert against its entity schema", () => {
    const row = vitals({ cardId: base.cardId });
    expect(mutationSchema.safeParse({ ...base, op: "child.upsert", entity: "vitalSigns", row }).success).toBe(true);
    expect(
      mutationSchema.safeParse({ ...base, op: "child.upsert", entity: "vitalSigns", row: { ...row, painScale: 15 } })
        .success,
    ).toBe(false);
  });

  it("rejects a child upsert whose row belongs to another card", () => {
    const row = vitals();
    expect(mutationSchema.safeParse({ ...base, op: "child.upsert", entity: "vitalSigns", row }).success).toBe(false);
  });

  it("accepts a batch containing an invalid mutation so it can be rejected individually", () => {
    const result = pushRequestSchema.safeParse({
      deviceId,
      mutations: [{ mutationId: newId(), op: "card.upsert", patch: { painScale: 99 } }],
    });
    expect(result.success).toBe(true);
  });
});
