import { Test } from '@nestjs/testing';
import { emptyCardFields, newId, type CasualtyCard } from '@tccc/shared';
import type { INestApplication } from '@nestjs/common';
import request, { type Test as Supertest } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { chaosState, updateChaos } from '../src/chaos/chaos.state.js';
import { configureApp } from '../src/common/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5434/tccc_medical_db';
process.env.CORS_ORIGIN = 'http://localhost:3000';

const DEVICE_A = '0192f300-0000-7000-8000-0000000000a1';
const DEVICE_B = '0192f300-0000-7000-8000-0000000000b1';
const WHEN = '2026-09-29T12:00:00.000Z';

function hlc(wall: number, deviceId = DEVICE_A): string {
  return `${String(wall).padStart(13, '0')}:0001:${deviceId}`;
}

function cardBody(id: string, extra: Record<string, unknown> = {}) {
  return { id, createdByDeviceId: DEVICE_A, ...emptyCardFields(), ...extra };
}

/**
 * Chaos drop swallows the response after the handler commits. supertest then
 * rejects. A delivered 2xx means the fault did not fire.
 */
async function expectDropped(call: Supertest): Promise<void> {
  let status: number | null = null;
  try {
    const response = await call.timeout({ response: 1_500, deadline: 2_500 });
    status = response.status;
  } catch {
    status = null;
  }
  expect(status).toBeNull();
}

describe('API under unstable network', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    chaosState.enabled = true;
    updateChaos({ latencyMs: 0, failureRate: 0, dropRate: 0 });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(() => {
    updateChaos({ latencyMs: 0, failureRate: 0, dropRate: 0 });
  });

  afterAll(async () => {
    updateChaos({ latencyMs: 0, failureRate: 0, dropRate: 0 });
    chaosState.enabled = false;
    if (!prisma) return;
    await prisma.syncConflict.deleteMany({ where: { discardedDeviceId: { in: [DEVICE_A, DEVICE_B] } } });
    await prisma.processedMutation.deleteMany({ where: { deviceId: { in: [DEVICE_A, DEVICE_B] } } });
    await prisma.casualtyCard.deleteMany({ where: { createdByDeviceId: { in: [DEVICE_A, DEVICE_B] } } });
    await prisma.device.deleteMany({ where: { id: { in: [DEVICE_A, DEVICE_B] } } });
    await app?.close();
  });

  async function createCard(lastName: string): Promise<CasualtyCard> {
    const response = await request(app.getHttpServer())
      .post('/api/casualties')
      .send(cardBody(newId(), { lastName, evacPriority: 'ROUTINE' }))
      .expect(201);
    return response.body as CasualtyCard;
  }

  async function load(id: string): Promise<CasualtyCard> {
    const response = await request(app.getHttpServer()).get(`/api/casualties/${id}`).expect(200);
    return response.body as CasualtyCard;
  }

  it('patches injury sites, fluids, and medications and rejects a stale If-Match', async () => {
    const card = await createCard('Patch');
    let version = card.version;
    const clock = hlc(1_790_000_100_000);

    const injuryId = newId();
    const createdInjury = await request(app.getHttpServer())
      .post(`/api/casualties/${card.id}/injury-sites`)
      .set('If-Match', String(version))
      .send({
        id: injuryId,
        region: 'CHEST',
        view: 'FRONT',
        x: 0.5,
        y: 0.4,
        description: null,
        clientUpdatedAt: clock,
      })
      .expect(201);
    version = createdInjury.body.version;

    const patchedInjury = await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/injury-sites/${injuryId}`)
      .set('If-Match', String(version))
      .send({ description: 'shrapnel', clientUpdatedAt: hlc(1_790_000_100_100) })
      .expect(200);
    version = patchedInjury.body.version;
    expect(patchedInjury.body.injurySites[0].description).toBe('shrapnel');
    expect(patchedInjury.body.changeSeq).not.toBe(card.changeSeq);

    await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/injury-sites/${injuryId}`)
      .set('If-Match', '1')
      .send({ description: 'stale', clientUpdatedAt: hlc(1_790_000_100_200) })
      .expect(412);

    const fluidId = newId();
    const createdFluid = await request(app.getHttpServer())
      .post(`/api/casualties/${card.id}/fluids`)
      .set('If-Match', String(version))
      .send({
        id: fluidId,
        kind: 'FLUID',
        name: 'Saline',
        volumeMl: 500,
        route: 'IV',
        administeredAt: WHEN,
        clientUpdatedAt: hlc(1_790_000_100_300),
      })
      .expect(201);
    version = createdFluid.body.version;

    const patchedFluid = await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/fluids/${fluidId}`)
      .set('If-Match', String(version))
      .send({ volumeMl: 250, clientUpdatedAt: hlc(1_790_000_100_400) })
      .expect(200);
    version = patchedFluid.body.version;
    expect(patchedFluid.body.fluids[0].volumeMl).toBe(250);

    const medicationId = newId();
    const createdMedication = await request(app.getHttpServer())
      .post(`/api/casualties/${card.id}/medications`)
      .set('If-Match', String(version))
      .send({
        id: medicationId,
        category: 'ANALGESIC',
        name: 'Ketamine',
        dose: '50 mg',
        route: 'IV',
        administeredAt: WHEN,
        clientUpdatedAt: hlc(1_790_000_100_500),
      })
      .expect(201);
    version = createdMedication.body.version;

    const patchedMedication = await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/medications/${medicationId}`)
      .set('If-Match', String(version))
      .send({ dose: '30 mg', clientUpdatedAt: hlc(1_790_000_100_600) })
      .expect(200);
    expect(patchedMedication.body.medications[0].dose).toBe('30 mg');
    expect(patchedMedication.body.version).toBe(version + 1);

    const stored = await load(card.id);
    expect(stored.injurySites[0]?.description).toBe('shrapnel');
    expect(stored.fluids[0]?.volumeMl).toBe(250);
    expect(stored.medications[0]?.dose).toBe('30 mg');
  });

  it('does not apply a child PATCH that chaos rejects with 503', async () => {
    const card = await createCard('Failure');
    const injuryId = newId();
    const created = await request(app.getHttpServer())
      .post(`/api/casualties/${card.id}/injury-sites`)
      .set('If-Match', String(card.version))
      .send({
        id: injuryId,
        region: 'HEAD',
        view: 'FRONT',
        x: 0.2,
        y: 0.2,
        description: 'original',
        clientUpdatedAt: hlc(1_790_000_110_000),
      })
      .expect(201);

    updateChaos({ failureRate: 1 });
    await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/injury-sites/${injuryId}`)
      .set('If-Match', String(created.body.version))
      .send({ description: 'should-not-stick', clientUpdatedAt: hlc(1_790_000_110_100) })
      .expect(503);

    const during = await load(card.id);
    expect(during.injurySites[0]?.description).toBe('original');
    expect(during.version).toBe(created.body.version);

    updateChaos({ failureRate: 0 });
    const retried = await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/injury-sites/${injuryId}`)
      .set('If-Match', String(created.body.version))
      .send({ description: 'retried', clientUpdatedAt: hlc(1_790_000_110_100) })
      .expect(200);
    expect(retried.body.injurySites[0].description).toBe('retried');
    expect(retried.body.version).toBe(created.body.version + 1);
  });

  it('keeps a dropped child PATCH committed exactly once', async () => {
    const card = await createCard('Drop');
    const cases = [
      {
        createPath: 'injury-sites',
        itemId: newId(),
        createBody: {
          region: 'ABDOMEN',
          view: 'FRONT',
          x: 0.4,
          y: 0.7,
          description: 'before',
          clientUpdatedAt: hlc(1_790_000_120_000),
        },
        patch: { description: 'after-drop', clientUpdatedAt: hlc(1_790_000_120_100) },
        read: (loaded: CasualtyCard) => loaded.injurySites[0]?.description,
        expected: 'after-drop',
      },
      {
        createPath: 'fluids',
        itemId: newId(),
        createBody: {
          kind: 'BLOOD_PRODUCT',
          name: 'Whole blood',
          volumeMl: 100,
          route: 'IO',
          administeredAt: WHEN,
          clientUpdatedAt: hlc(1_790_000_120_200),
        },
        patch: { volumeMl: 450, clientUpdatedAt: hlc(1_790_000_120_300) },
        read: (loaded: CasualtyCard) => loaded.fluids.find((row) => row.volumeMl === 450 || row.volumeMl === 100)?.volumeMl,
        expected: 450,
      },
      {
        createPath: 'medications',
        itemId: newId(),
        createBody: {
          category: 'ANTIBIOTIC',
          name: 'Moxifloxacin',
          dose: '400 mg',
          route: 'IV',
          administeredAt: WHEN,
          clientUpdatedAt: hlc(1_790_000_120_400),
        },
        patch: { dose: '400 mg PO', clientUpdatedAt: hlc(1_790_000_120_500) },
        read: (loaded: CasualtyCard) => loaded.medications[0]?.dose,
        expected: '400 mg PO',
      },
    ] as const;

    let version = card.version;
    for (const item of cases) {
      const created = await request(app.getHttpServer())
        .post(`/api/casualties/${card.id}/${item.createPath}`)
        .set('If-Match', String(version))
        .send({ id: item.itemId, ...item.createBody })
        .expect(201);
      version = created.body.version;
      const seen = version;

      updateChaos({ dropRate: 1 });
      await expectDropped(
        request(app.getHttpServer())
          .patch(`/api/casualties/${card.id}/${item.createPath}/${item.itemId}`)
          .set('If-Match', String(seen))
          .send(item.patch),
      );

      const committed = await load(card.id);
      expect(item.read(committed)).toBe(item.expected);
      expect(committed.version).toBe(seen + 1);
      version = committed.version;

      updateChaos({ dropRate: 0 });
      await request(app.getHttpServer())
        .patch(`/api/casualties/${card.id}/${item.createPath}/${item.itemId}`)
        .set('If-Match', String(seen))
        .send(item.patch)
        .expect(412);

      const afterRetry = await load(card.id);
      expect(item.read(afterRetry)).toBe(item.expected);
      expect(afterRetry.version).toBe(version);
    }
  }, 30_000);

  it('still applies a child PATCH when chaos adds latency', async () => {
    const card = await createCard('Latency');
    const vitalId = newId();
    const created = await request(app.getHttpServer())
      .post(`/api/casualties/${card.id}/vitals`)
      .set('If-Match', String(card.version))
      .send({
        id: vitalId,
        measuredAt: WHEN,
        pulseRate: 80,
        pulseLocation: null,
        systolic: null,
        diastolic: null,
        respiratoryRate: null,
        spo2: null,
        avpu: 'ALERT',
        painScale: 2,
        clientUpdatedAt: hlc(1_790_000_130_000),
      })
      .expect(201);

    updateChaos({ latencyMs: 250 });
    const patched = await request(app.getHttpServer())
      .patch(`/api/casualties/${card.id}/vitals/${vitalId}`)
      .set('If-Match', String(created.body.version))
      .send({ pulseRate: 110, clientUpdatedAt: hlc(1_790_000_130_100) })
      .expect(200);
    expect(patched.body.vitalSigns[0].pulseRate).toBe(110);
    expect(patched.body.version).toBe(created.body.version + 1);
  });

  it('applies each child sync mutation once when the response is dropped', async () => {
    const cardId = newId();
    const created = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: null,
            patch: { lastName: 'SyncDrop', evacPriority: 'ROUTINE' },
            changedFields: ['lastName', 'evacPriority'],
            hlc: hlc(1_790_000_140_000),
          },
        ],
      })
      .expect(201);
    expect(created.body.results[0].status).toBe('applied');

    const injuryId = newId();
    const tourniquetId = newId();
    const vitalId = newId();
    const fluidId = newId();
    const medicationId = newId();
    const rows = [
      {
        entity: 'injurySite' as const,
        id: injuryId,
        row: {
          id: injuryId,
          cardId,
          clientUpdatedAt: hlc(1_790_000_141_000),
          deletedAt: null,
          region: 'RIGHT_ARM',
          view: 'FRONT',
          x: 0.3,
          y: 0.5,
          description: 'wound',
        },
      },
      {
        entity: 'tourniquet' as const,
        id: tourniquetId,
        row: {
          id: tourniquetId,
          cardId,
          clientUpdatedAt: hlc(1_790_000_142_000),
          deletedAt: null,
          limb: 'LEFT_ARM',
          type: 'CAT',
          appliedAt: WHEN,
        },
      },
      {
        entity: 'vitalSigns' as const,
        id: vitalId,
        row: {
          id: vitalId,
          cardId,
          clientUpdatedAt: hlc(1_790_000_143_000),
          deletedAt: null,
          measuredAt: WHEN,
          pulseRate: 88,
          pulseLocation: 'radial',
          systolic: 120,
          diastolic: 80,
          respiratoryRate: 16,
          spo2: 98,
          avpu: 'ALERT',
          painScale: 3,
        },
      },
      {
        entity: 'fluid' as const,
        id: fluidId,
        row: {
          id: fluidId,
          cardId,
          clientUpdatedAt: hlc(1_790_000_144_000),
          deletedAt: null,
          kind: 'FLUID',
          name: 'Saline',
          volumeMl: 500,
          route: 'IV',
          administeredAt: WHEN,
        },
      },
      {
        entity: 'medication' as const,
        id: medicationId,
        row: {
          id: medicationId,
          cardId,
          clientUpdatedAt: hlc(1_790_000_145_000),
          deletedAt: null,
          category: 'ANALGESIC',
          name: 'Ketamine',
          dose: '50 mg',
          route: 'IV',
          administeredAt: WHEN,
        },
      },
    ];

    let version = 1;
    for (const [index, item] of rows.entries()) {
      const mutation = {
        mutationId: newId(),
        cardId,
        op: 'child.upsert',
        entity: item.entity,
        baseVersion: version,
        hlc: hlc(1_790_000_141_000 + index * 1_000),
        row: item.row,
      };
      updateChaos({ dropRate: 1 });
      await expectDropped(request(app.getHttpServer()).post('/api/sync/push').send({ deviceId: DEVICE_A, mutations: [mutation] }));
      expect(await childCount(item.entity, cardId)).toBe(1);

      updateChaos({ dropRate: 0 });
      const replay = await request(app.getHttpServer())
        .post('/api/sync/push')
        .send({ deviceId: DEVICE_A, mutations: [mutation] })
        .expect(201);
      expect(replay.body.results[0].status).toBe('applied');
      expect(replay.body.results[0].card.version).toBe(version + 1);
      version += 1;
      expect(await prisma.processedMutation.count({ where: { mutationId: mutation.mutationId } })).toBe(1);
    }

    expect(await prisma.injurySite.count({ where: { cardId } })).toBe(1);
    expect(await prisma.tourniquet.count({ where: { cardId } })).toBe(1);
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(1);
    expect(await prisma.fluidAdministration.count({ where: { cardId } })).toBe(1);
    expect(await prisma.medication.count({ where: { cardId } })).toBe(1);

    const loaded = await load(cardId);
    version = loaded.version;
    const deletion = {
      mutationId: newId(),
      cardId,
      op: 'child.delete',
      entity: 'vitalSigns',
      entityId: vitalId,
      baseVersion: version,
      deletedAt: WHEN,
      hlc: hlc(1_790_000_150_000),
    };
    updateChaos({ dropRate: 1 });
    await expectDropped(request(app.getHttpServer()).post('/api/sync/push').send({ deviceId: DEVICE_A, mutations: [deletion] }));
    expect(await prisma.vitalSigns.count({ where: { cardId, deletedAt: { not: null } } })).toBe(1);

    updateChaos({ dropRate: 0 });
    const replayDelete = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({ deviceId: DEVICE_A, mutations: [deletion] })
      .expect(201);
    expect(replayDelete.body.results[0].status).toBe('applied');
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(1);
    expect((await load(cardId)).version).toBe(version + 1);
  }, 40_000);

  it('retries a rejected child upsert without duplicating the row', async () => {
    const cardId = newId();
    const vitalId = newId();
    await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: null,
            patch: { lastName: 'Retry' },
            changedFields: ['lastName'],
            hlc: hlc(1_790_000_160_000),
          },
        ],
      })
      .expect(201);

    const mutation = {
      mutationId: newId(),
      cardId,
      op: 'child.upsert',
      entity: 'vitalSigns',
      baseVersion: 1,
      hlc: hlc(1_790_000_160_100),
      row: {
        id: vitalId,
        cardId,
        clientUpdatedAt: hlc(1_790_000_160_100),
        deletedAt: null,
        measuredAt: WHEN,
        pulseRate: 90,
        pulseLocation: null,
        systolic: null,
        diastolic: null,
        respiratoryRate: null,
        spo2: null,
        avpu: null,
        painScale: 1,
      },
    };

    updateChaos({ failureRate: 1 });
    await request(app.getHttpServer()).post('/api/sync/push').send({ deviceId: DEVICE_A, mutations: [mutation] }).expect(503);
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(0);

    updateChaos({ failureRate: 0 });
    const applied = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({ deviceId: DEVICE_A, mutations: [mutation] })
      .expect(201);
    expect(applied.body.results[0].status).toBe('applied');
    expect(applied.body.results[0].card.vitalSigns).toEqual([expect.objectContaining({ id: vitalId, pulseRate: 90 })]);

    const again = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({ deviceId: DEVICE_A, mutations: [mutation] })
      .expect(201);
    expect(again.body.results).toEqual(applied.body.results);
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(1);
  });

  it('merges a stale vitals edit from a second device while chaos adds latency', async () => {
    const cardId = newId();
    const vitalId = newId();
    const firstClock = hlc(1_790_000_170_000, DEVICE_A);
    await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: null,
            patch: { lastName: 'Conflict' },
            changedFields: ['lastName'],
            hlc: hlc(1_790_000_169_000, DEVICE_A),
          },
          {
            mutationId: newId(),
            cardId,
            op: 'child.upsert',
            entity: 'vitalSigns',
            baseVersion: 1,
            hlc: firstClock,
            row: {
              id: vitalId,
              cardId,
              clientUpdatedAt: firstClock,
              deletedAt: null,
              measuredAt: WHEN,
              pulseRate: 70,
              pulseLocation: null,
              systolic: null,
              diastolic: null,
              respiratoryRate: null,
              spo2: null,
              avpu: null,
              painScale: 4,
            },
          },
        ],
      })
      .expect(201);

    const winnerClock = hlc(1_790_000_171_000, DEVICE_B);
    updateChaos({ latencyMs: 200 });
    const merged = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_B,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'child.upsert',
            entity: 'vitalSigns',
            baseVersion: 1,
            hlc: winnerClock,
            row: {
              id: vitalId,
              cardId,
              clientUpdatedAt: winnerClock,
              deletedAt: null,
              measuredAt: WHEN,
              pulseRate: 99,
              pulseLocation: null,
              systolic: null,
              diastolic: null,
              respiratoryRate: null,
              spo2: null,
              avpu: 'VERBAL',
              painScale: 4,
            },
          },
        ],
      })
      .expect(201);

    expect(merged.body.results[0].status).toBe('merged');
    expect(merged.body.results[0].card.vitalSigns[0].pulseRate).toBe(99);
    expect(merged.body.results[0].conflicts).toEqual([
      expect.objectContaining({ entity: 'vitalSigns', entityId: vitalId, field: 'row' }),
    ]);
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(1);
    expect(await prisma.syncConflict.count({ where: { cardId, entity: 'vitalSigns' } })).toBe(1);
  });

  async function childCount(entity: 'injurySite' | 'tourniquet' | 'vitalSigns' | 'fluid' | 'medication', cardId: string) {
    if (entity === 'injurySite') return prisma.injurySite.count({ where: { cardId } });
    if (entity === 'tourniquet') return prisma.tourniquet.count({ where: { cardId } });
    if (entity === 'vitalSigns') return prisma.vitalSigns.count({ where: { cardId } });
    if (entity === 'fluid') return prisma.fluidAdministration.count({ where: { cardId } });
    return prisma.medication.count({ where: { cardId } });
  }
});
