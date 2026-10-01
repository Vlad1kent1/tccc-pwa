import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CARD_FIELDS,
  casualtyCardSchema,
  formatHlc,
  newId,
  tickHlc,
  tourniquetId,
  type AirwayTreatment,
  type Avpu,
  type BodyRegion,
  type BreathingTreatment,
  type CirculationTreatment,
  type EvacPriority,
  type HlcState,
  type Limb,
  type MechanismOfInjury,
  type OtherTreatment,
} from '@tccc/shared';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { cardWithChildren, toCardDto } from '../src/prisma/card-serializer.js';
import { nextChangeSeq } from '../src/prisma/change-seq.js';

const SEED_DEVICE_ID = '0192f000-0000-7000-8000-000000005eed';
const CARD_COUNT = 20;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Mulberry32: deterministic so repeated seeds produce identical data.
function createRng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = createRng(1380);
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)]!;
const int = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;
const sample = <T>(items: readonly T[], max: number): T[] =>
  [...items].sort(() => rand() - 0.5).slice(0, int(0, max));

const LAST_NAMES = ['Kovalenko', 'Shevchenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Oliinyk', 'Melnyk', 'Boiko', 'Moroz', 'Lysenko'];
const FIRST_NAMES = ['Oleksandr', 'Andrii', 'Dmytro', 'Serhii', 'Ivan', 'Olena', 'Nataliia', 'Maksym', 'Yurii', 'Kateryna'];
const FEMALE_NAMES = new Set(['Olena', 'Nataliia', 'Kateryna']);
const RESPONDERS = [
  { name: 'Hnatiuk V.', last4: '4821' },
  { name: 'Savchuk O.', last4: '1937' },
  { name: 'Rudenko M.', last4: '7302' },
];
const MECHANISMS: MechanismOfInjury[] = ['ARTILLERY', 'BLUNT', 'BURN', 'FALL', 'GRENADE', 'GSW', 'IED', 'LANDMINE', 'MVC', 'RPG'];
const REGIONS: BodyRegion[] = ['HEAD', 'FACE', 'NECK', 'CHEST', 'ABDOMEN', 'PELVIS', 'UPPER_BACK', 'LOWER_BACK', 'RIGHT_ARM', 'LEFT_ARM', 'RIGHT_LEG', 'LEFT_LEG'];
const LIMBS: Limb[] = ['RIGHT_ARM', 'LEFT_ARM', 'RIGHT_LEG', 'LEFT_LEG'];
const PRIORITIES: EvacPriority[] = ['URGENT', 'PRIORITY', 'ROUTINE'];
const AVPU: Avpu[] = ['ALERT', 'VERBAL', 'PAIN', 'UNRESPONSIVE'];
const AIRWAY: AirwayTreatment[] = ['NPA', 'CRIC', 'ET_TUBE', 'SGA'];
const BREATHING: BreathingTreatment[] = ['O2', 'NEEDLE_D', 'CHEST_TUBE', 'CHEST_SEAL'];
const OTHER: OtherTreatment[] = ['EYE_SHIELD', 'SPLINT', 'HYPOTHERMIA_PREVENTION'];
const ALLERGIES = [null, null, null, 'NKA', 'Penicillin', 'Latex'];

const MINUTE = 60_000;
const BASE_TIME = Date.UTC(2026, 8, 20, 6, 0, 0);

let clock: HlcState = { wallTime: 0, counter: 0, nodeId: SEED_DEVICE_ID };
function nextHlc(at: number): string {
  clock = tickHlc(clock, at);
  return formatHlc(clock);
}

async function seedCard(index: number): Promise<void> {
  const cardId = newId();
  const injuredAt = BASE_TIME + index * 37 * MINUTE;
  const firstName = pick(FIRST_NAMES);
  const responder = pick(RESPONDERS);
  const mechanisms = sample(MECHANISMS, 2);
  if (mechanisms.length === 0) mechanisms.push(pick(MECHANISMS));

  const tqLimbs = chance(0.5) ? sample(LIMBS, 2) : [];
  const circulation = new Set<CirculationTreatment>(
    sample(['DRESSING', 'HEMOSTATIC', 'PRESSURE'] as const, 2),
  );
  if (tqLimbs.length > 0) circulation.add('TOURNIQUET');
  const airwayCompromised = chance(0.25);
  const priority = tqLimbs.length > 0 || airwayCompromised ? 'URGENT' : pick(PRIORITIES);

  const writtenAt = injuredAt + 10 * MINUTE;
  const cardHlc = nextHlc(writtenAt);
  const fieldClock = Object.fromEntries(CARD_FIELDS.map((f) => [f, cardHlc]));

  await prisma.$transaction(async (tx) => {
    await tx.casualtyCard.create({
      data: {
        id: cardId,
        lastName: pick(LAST_NAMES),
        firstName,
        gender: FEMALE_NAMES.has(firstName) ? 'FEMALE' : 'MALE',
        injuredAt: new Date(injuredAt),
        battleRosterNumber: `${firstName[0]}K${String(1000 + index)}`,
        evacPriority: priority,
        allergies: pick(ALLERGIES),
        mechanisms,
        mechanismOther: null,
        circulation: [...circulation],
        airway: airwayCompromised ? [pick(AIRWAY)] : ['INTACT'],
        breathing: sample(BREATHING, 1),
        otherTreatments: sample(OTHER, 2),
        notes: chance(0.4) ? 'Casualty evacuated by ground CASEVAC.' : null,
        responderName: responder.name,
        responderLast4: responder.last4,
        fieldClock,
        changeSeq: await nextChangeSeq(tx),
        createdByDeviceId: SEED_DEVICE_ID,
      },
    });

    const sites = Array.from({ length: int(1, 3) }, () => ({
      id: newId(),
      cardId,
      region: pick(REGIONS),
      view: chance(0.7) ? ('FRONT' as const) : ('BACK' as const),
      x: Number(rand().toFixed(3)),
      y: Number(rand().toFixed(3)),
      description: pick(['Penetrating wound', 'Laceration', 'Burn, partial thickness', 'Fragment wound', null]),
      clientUpdatedAt: cardHlc,
    }));
    await tx.injurySite.createMany({ data: sites });

    if (tqLimbs.length > 0) {
      await tx.tourniquet.createMany({
        data: tqLimbs.map((limb) => ({
          id: tourniquetId(cardId, limb),
          cardId,
          limb,
          type: pick(['CAT', 'SOFTT-W']),
          appliedAt: new Date(injuredAt + int(1, 5) * MINUTE),
          clientUpdatedAt: cardHlc,
        })),
      });
    }

    const vitalsCount = int(1, 4);
    await tx.vitalSigns.createMany({
      data: Array.from({ length: vitalsCount }, (_, i) => {
        const at = injuredAt + (5 + i * 15) * MINUTE;
        const systolic = int(80, 140);
        return {
          id: newId(),
          cardId,
          measuredAt: new Date(at),
          pulseRate: int(60, 140),
          pulseLocation: pick(['radial', 'carotid']),
          systolic,
          diastolic: Math.min(systolic, int(50, 90)),
          respiratoryRate: int(10, 30),
          spo2: int(85, 100),
          avpu: airwayCompromised ? pick(AVPU) : 'ALERT',
          painScale: int(0, 10),
          clientUpdatedAt: nextHlc(at),
        };
      }),
    });

    if (chance(0.5)) {
      const blood = chance(0.5);
      await tx.fluidAdministration.create({
        data: {
          id: newId(),
          cardId,
          kind: blood ? 'BLOOD_PRODUCT' : 'FLUID',
          name: blood ? 'Whole blood' : 'Lactated Ringer',
          volumeMl: blood ? 500 : 1000,
          route: chance(0.8) ? 'IV' : 'IO',
          administeredAt: new Date(injuredAt + 20 * MINUTE),
          clientUpdatedAt: cardHlc,
        },
      });
    }

    const meds = [
      { category: 'ANALGESIC' as const, name: 'Ketamine', dose: '50 mg', route: 'IM' as const },
      { category: 'ANALGESIC' as const, name: 'Fentanyl OTFC', dose: '800 mcg', route: 'OTHER' as const },
      { category: 'ANTIBIOTIC' as const, name: 'Moxifloxacin', dose: '400 mg', route: 'PO' as const },
      { category: 'OTHER' as const, name: 'TXA', dose: '2 g', route: 'IV' as const },
    ];
    await tx.medication.createMany({
      data: sample(meds, 3).map((m) => ({
        id: newId(),
        cardId,
        ...m,
        administeredAt: new Date(injuredAt + int(10, 40) * MINUTE),
        clientUpdatedAt: cardHlc,
      })),
    });
  });
}

async function main(): Promise<void> {
  const removed = await prisma.casualtyCard.deleteMany({
    where: { createdByDeviceId: SEED_DEVICE_ID },
  });
  await prisma.device.upsert({
    where: { id: SEED_DEVICE_ID },
    create: { id: SEED_DEVICE_ID, label: 'Seed script', lastSeenAt: new Date() },
    update: { lastSeenAt: new Date() },
  });
  for (let i = 0; i < CARD_COUNT; i++) {
    await seedCard(i);
  }

  const cards = await prisma.casualtyCard.findMany({
    where: { createdByDeviceId: SEED_DEVICE_ID },
    include: cardWithChildren,
  });
  for (const card of cards) {
    const result = casualtyCardSchema.safeParse(toCardDto(card));
    if (!result.success) {
      throw new Error(
        `Seeded card ${card.id} fails casualtyCardSchema:\n${z.prettifyError(result.error)}`,
      );
    }
  }
  console.log(
    `Seed: removed ${removed.count} old cards, created and validated ${cards.length}.`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
