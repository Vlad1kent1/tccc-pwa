import { describe, expect, it } from "vitest";
import { formatHlc } from "../hlc.js";
import { newId, tourniquetId } from "../ids.js";
import {
  cardPatchSchema,
  casualtyCardSchema,
  childSchemas,
  completeFluidSchema,
  completeMedicationSchema,
  completeVitalSignsSchema,
  emptyCardFields,
  fluidSchema,
  medicationSchema,
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
    const { lastName, firstName, gender, injuredAt, battleRosterNumber, evacPriority, allergies, casualtyLast4, service, unit } =
      emptyCardFields();
    expect(
      sectionASchema.safeParse({
        lastName,
        firstName,
        gender,
        injuredAt,
        battleRosterNumber,
        evacPriority,
        allergies,
        casualtyLast4,
        service,
        unit,
      }).success,
    ).toBe(true);
  });

  it("requires exactly four digits for the casualty last 4", () => {
    expect(cardPatchSchema.safeParse({ casualtyLast4: "0427" }).success).toBe(true);
    expect(cardPatchSchema.safeParse({ casualtyLast4: "042" }).success).toBe(false);
    expect(cardPatchSchema.safeParse({ casualtyLast4: null }).success).toBe(true);
  });

  it("accepts paper-card treatment details as card fields", () => {
    const patch = {
      tqJunctional: true,
      eyeShieldLeft: true,
      combatPillPack: true,
      circulationTqType: "CAT",
      hypothermiaType: "HPMK",
      rowDrafts: { [newId()]: { time: "14" } },
    };
    expect(cardPatchSchema.safeParse(patch).success).toBe(true);
    expect(cardPatchSchema.safeParse({ tqExtremity: "yes" }).success).toBe(false);
    expect(cardPatchSchema.safeParse({ rowDrafts: { row: { time: "x".repeat(201) } } }).success).toBe(false);
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

  it("syncs a row with only its time, but counts it complete only with a measurement", () => {
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
    expect(vitalSignsSchema.safeParse(empty).success).toBe(true);
    expect(completeVitalSignsSchema.safeParse(empty).success).toBe(false);
    expect(completeVitalSignsSchema.safeParse({ ...empty, avpu: "PAIN" }).success).toBe(true);
  });

  it("rejects systolic lower than diastolic", () => {
    expect(vitalSignsSchema.safeParse(vitals({ systolic: 70, diastolic: 90 })).success).toBe(false);
    expect(completeVitalSignsSchema.safeParse(vitals({ systolic: 70, diastolic: 90 })).success).toBe(false);
  });
});

describe("injury sites", () => {
  it("reads a row from a device that does not send siteCode yet as a free mark", () => {
    const row = { id: newId(), cardId: newId(), clientUpdatedAt: hlc, deletedAt: null, region: "CHEST", view: "FRONT", x: 0.4, y: 0.3, description: null };
    expect(childSchemas.injurySite.parse(row).siteCode).toBeNull();
    expect(childSchemas.injurySite.parse({ ...row, siteCode: "Ant_Right_Shoulder" }).siteCode).toBe("Ant_Right_Shoulder");
  });
});

describe("unfinished fluid and medication rows", () => {
  const base = { id: newId(), cardId: newId(), clientUpdatedAt: hlc, deletedAt: null };

  it("syncs a fluid with only a name, and rejects one with nothing filled in", () => {
    const partial = { ...base, kind: "FLUID", name: "LR", volumeMl: null, route: null, administeredAt: null };
    expect(fluidSchema.safeParse(partial).success).toBe(true);
    expect(completeFluidSchema.safeParse(partial).success).toBe(false);
    expect(fluidSchema.safeParse({ ...partial, name: "  " }).success).toBe(false);
    expect(completeFluidSchema.safeParse({ ...partial, volumeMl: 500, route: "IV", administeredAt: now }).success).toBe(true);
  });

  it("syncs a medication with only a dose, and rejects one with nothing filled in", () => {
    const partial = { ...base, category: "ANALGESIC", name: "", dose: "50 mg", route: null, administeredAt: null };
    expect(medicationSchema.safeParse(partial).success).toBe(true);
    expect(completeMedicationSchema.safeParse(partial).success).toBe(false);
    expect(medicationSchema.safeParse({ ...partial, dose: "" }).success).toBe(false);
  });

  it("carries an unfinished row in a child upsert", () => {
    const cardId = newId();
    const row = { ...base, cardId, kind: "BLOOD_PRODUCT", name: "", volumeMl: 250, route: null, administeredAt: null };
    const mutation = { op: "child.upsert", entity: "fluid", row, mutationId: newId(), cardId, hlc, baseVersion: null };
    expect(mutationSchema.safeParse(mutation).success).toBe(true);
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
