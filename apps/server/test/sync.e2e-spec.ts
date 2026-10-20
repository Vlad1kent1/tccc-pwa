import { Test } from '@nestjs/testing';
import { newId, type CasualtyCard, type MutationResult, type PushResponse } from '@tccc/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SyncModule } from '../src/sync/sync.module.js';

const DATABASE_URL = 'postgresql://postgres:password@localhost:5434/tccc_medical_db';
process.env.DATABASE_URL = DATABASE_URL;

const DEVICE_A = '0192f100-0000-7000-8000-00000000000a';
const DEVICE_B = '0192f100-0000-7000-8000-00000000000b';

function hlc(wall: number, deviceId: string): string {
  return `${String(wall).padStart(13, '0')}:0001:${deviceId}`;
}

describe('sync API', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SyncModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.syncConflict.deleteMany({ where: { discardedDeviceId: { in: [DEVICE_A, DEVICE_B] } } });
    await prisma.processedMutation.deleteMany({ where: { deviceId: { in: [DEVICE_A, DEVICE_B] } } });
    await prisma.casualtyCard.deleteMany({ where: { createdByDeviceId: { in: [DEVICE_A, DEVICE_B] } } });
    await prisma.device.deleteMany({ where: { id: { in: [DEVICE_A, DEVICE_B] } } });
    await app?.close();
  });

  it('returns the same results and writes no extra rows when a batch is pushed twice', async () => {
    const cardId = newId();
    const batch = {
      deviceId: DEVICE_A,
      mutations: [
        {
          mutationId: newId(),
          cardId,
          op: 'card.upsert',
          baseVersion: null,
          patch: { lastName: 'Shevchenko', evacPriority: 'ROUTINE' },
          changedFields: ['lastName', 'evacPriority'],
          hlc: hlc(1_790_000_000_000, DEVICE_A),
        },
        {
          mutationId: newId(),
          cardId,
          op: 'card.upsert',
          baseVersion: 1,
          patch: { allergies: 'Penicillin' },
          changedFields: ['allergies'],
          hlc: hlc(1_790_000_000_100, DEVICE_A),
        },
      ],
    };

    const first = await request(app.getHttpServer()).post('/api/sync/push').send(batch).expect(201);
    const again = await request(app.getHttpServer()).post('/api/sync/push').send(batch).expect(201);

    expect(again.body.results).toEqual(first.body.results);
    expect(first.body.results.map((result: MutationResult) => result.status)).toEqual(['applied', 'applied']);

    const body = first.body as PushResponse;
    const card = (body.results[1] as { card: CasualtyCard }).card;
    expect(card.allergies).toBe('Penicillin');
    expect(card.version).toBe(2);

    expect(await prisma.casualtyCard.count({ where: { id: cardId } })).toBe(1);
    expect(await prisma.processedMutation.count({ where: { mutationId: { in: batch.mutations.map((m) => m.mutationId) } } })).toBe(2);

    const pulled = await request(app.getHttpServer()).get('/api/sync/pull').query({ since: '0', limit: 500 }).expect(200);
    const found = (pulled.body.cards as CasualtyCard[]).find((item) => item.id === cardId);
    expect(found?.lastName).toBe('Shevchenko');
    expect(found?.allergies).toBe('Penicillin');
  });

  it('merges a stale edit from a second device into exactly one conflict', async () => {
    const cardId = newId();
    const create = {
      deviceId: DEVICE_A,
      mutations: [
        {
          mutationId: newId(),
          cardId,
          op: 'card.upsert',
          baseVersion: null,
          patch: { evacPriority: 'ROUTINE' },
          changedFields: ['evacPriority'],
          hlc: hlc(1_790_000_001_000, DEVICE_A),
        },
      ],
    };
    await request(app.getHttpServer()).post('/api/sync/push').send(create).expect(201);

    const fromA = {
      deviceId: DEVICE_A,
      mutations: [
        {
          mutationId: newId(),
          cardId,
          op: 'card.upsert',
          baseVersion: 1,
          patch: { evacPriority: 'URGENT' },
          changedFields: ['evacPriority'],
          hlc: hlc(1_790_000_002_000, DEVICE_A),
        },
      ],
    };
    const applied = await request(app.getHttpServer()).post('/api/sync/push').send(fromA).expect(201);
    expect(applied.body.results[0].status).toBe('applied');

    const fromB = {
      deviceId: DEVICE_B,
      mutations: [
        {
          mutationId: newId(),
          cardId,
          op: 'card.upsert',
          baseVersion: 1,
          patch: { evacPriority: 'PRIORITY' },
          changedFields: ['evacPriority'],
          hlc: hlc(1_790_000_003_000, DEVICE_B),
        },
      ],
    };
    const merged = await request(app.getHttpServer()).post('/api/sync/push').send(fromB).expect(201);

    expect(merged.body.results[0].status).toBe('merged');
    expect(merged.body.results[0].conflicts).toEqual([
      expect.objectContaining({
        entity: 'card',
        entityId: cardId,
        field: 'evacPriority',
        kept: 'PRIORITY',
        discarded: 'URGENT',
      }),
    ]);
    expect(merged.body.results[0].card.evacPriority).toBe('PRIORITY');
    expect(await prisma.syncConflict.count({ where: { cardId } })).toBe(1);

    const listed = await request(app.getHttpServer())
      .get('/api/sync/conflicts')
      .query({ cardId, resolved: 'false' })
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(merged.body.results[0].conflicts[0].id);

    const resolved = await request(app.getHttpServer())
      .post(`/api/sync/conflicts/${listed.body[0].id}/resolve`)
      .send({ choice: 'discarded' })
      .expect(201);
    expect(resolved.body.card.evacPriority).toBe('URGENT');
    expect(resolved.body.conflict.resolvedBy).toBe('discarded');
    expect(await prisma.syncConflict.count({ where: { cardId } })).toBe(1);
  });

  it('drops an older offline edit even when its base version matches', async () => {
    const cardId = newId();
    const push = (deviceId: string, mutation: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/sync/push')
        .send({ deviceId, mutations: [{ mutationId: newId(), cardId, ...mutation }] })
        .expect(201);

    await push(DEVICE_A, {
      op: 'card.upsert',
      baseVersion: null,
      patch: { lastName: 'Kravets' },
      changedFields: ['lastName'],
      hlc: hlc(1_790_000_006_000, DEVICE_A),
    });
    const fromB = await push(DEVICE_B, {
      op: 'card.upsert',
      baseVersion: 1,
      patch: { allergies: 'Penicillin' },
      changedFields: ['allergies'],
      hlc: hlc(1_790_000_006_300, DEVICE_B),
    });
    expect(fromB.body.results[0].status).toBe('applied');

    // Device A edited offline before B, then rebased its queued edit onto version 2.
    const stale = await push(DEVICE_A, {
      op: 'card.upsert',
      baseVersion: 2,
      patch: { allergies: 'NKA' },
      changedFields: ['allergies'],
      hlc: hlc(1_790_000_006_100, DEVICE_A),
    });

    expect(stale.body.results[0].status).toBe('merged');
    expect(stale.body.results[0].card.allergies).toBe('Penicillin');
    expect(stale.body.results[0].conflicts).toEqual([
      expect.objectContaining({ field: 'allergies', kept: 'Penicillin', discarded: 'NKA' }),
    ]);
  });

  it('stores an unfinished fluid row and returns it on pull', async () => {
    const cardId = newId();
    const fluidId = newId();
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
            patch: { lastName: 'Lysenko' },
            changedFields: ['lastName'],
            hlc: hlc(1_790_000_007_000, DEVICE_A),
          },
          {
            mutationId: newId(),
            cardId,
            op: 'child.upsert',
            entity: 'fluid',
            baseVersion: null,
            hlc: hlc(1_790_000_007_100, DEVICE_A),
            row: {
              id: fluidId,
              cardId,
              kind: 'FLUID',
              name: 'LR',
              volumeMl: null,
              route: null,
              administeredAt: null,
              clientUpdatedAt: hlc(1_790_000_007_100, DEVICE_A),
              deletedAt: null,
            },
          },
        ],
      })
      .expect(201);

    const pulled = await request(app.getHttpServer()).get('/api/sync/pull').query({ since: '0', limit: 500 }).expect(200);
    const found = (pulled.body.cards as CasualtyCard[]).find((item) => item.id === cardId);
    expect(found?.fluids).toEqual([
      expect.objectContaining({ id: fluidId, name: 'LR', volumeMl: null, route: null, administeredAt: null }),
    ]);
  });

  it('rejects an invalid mutation without failing the rest of the batch', async () => {
    const cardId = newId();
    const response = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: null,
            patch: { lastName: 'Bondarenko' },
            changedFields: ['lastName'],
            hlc: hlc(1_790_000_004_000, DEVICE_A),
          },
          {
            mutationId: newId(),
            cardId,
            op: 'child.upsert',
            entity: 'vitalSigns',
            baseVersion: null,
            hlc: hlc(1_790_000_004_100, DEVICE_A),
            row: {
              id: newId(),
              cardId,
              measuredAt: '2026-09-24T12:00:00.000Z',
              pulseRate: null,
              pulseLocation: null,
              systolic: null,
              diastolic: null,
              respiratoryRate: null,
              spo2: null,
              avpu: null,
              painScale: 15,
              clientUpdatedAt: hlc(1_790_000_004_100, DEVICE_A),
              deletedAt: null,
            },
          },
        ],
      })
      .expect(201);

    expect(response.body.results[0].status).toBe('applied');
    expect(response.body.results[1].status).toBe('rejected');
    expect(response.body.results[1].error.code).toBe('VALIDATION');
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(0);
  });

  it('restores a discarded vital row through the conflict id from push', async () => {
    const cardId = newId();
    const vitalId = newId();
    const measuredAt = '2026-09-24T12:00:00.000Z';
    const vital = (pulseRate: number, clock: string) => ({
      id: vitalId,
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
    });

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
            patch: { lastName: 'Melnyk' },
            changedFields: ['lastName'],
            hlc: hlc(1_790_000_005_000, DEVICE_A),
          },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'child.upsert',
            entity: 'vitalSigns',
            baseVersion: 1,
            hlc: hlc(1_790_000_005_100, DEVICE_A),
            row: vital(70, hlc(1_790_000_005_100, DEVICE_A)),
          },
        ],
      })
      .expect(201);

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
            hlc: hlc(1_790_000_005_200, DEVICE_B),
            row: vital(99, hlc(1_790_000_005_200, DEVICE_B)),
          },
        ],
      })
      .expect(201);

    expect(merged.body.results[0].status).toBe('merged');
    expect(merged.body.results[0].card.vitalSigns[0].pulseRate).toBe(99);
    const conflictId = merged.body.results[0].conflicts[0].id as string;
    expect(conflictId).toEqual(expect.any(String));

    const resolved = await request(app.getHttpServer())
      .post(`/api/sync/conflicts/${conflictId}/resolve`)
      .send({ choice: 'discarded' })
      .expect(201);

    expect(resolved.body.conflict.resolvedBy).toBe('discarded');
    expect(resolved.body.card.vitalSigns).toEqual([
      expect.objectContaining({ id: vitalId, pulseRate: 70, deletedAt: null }),
    ]);
    expect(await prisma.vitalSigns.count({ where: { cardId } })).toBe(1);
  });

  it('records no conflict when a device edits a card it created before the create was acknowledged', async () => {
    const cardId = newId();
    // Both still claim no base version: the device pushed them together, before it saw version 1.
    const response = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: null,
            patch: { lastName: 'Kravets', evacPriority: null },
            changedFields: ['lastName', 'evacPriority'],
            hlc: hlc(1_790_000_010_000, DEVICE_A),
          },
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: null,
            patch: { evacPriority: 'ROUTINE' },
            changedFields: ['evacPriority'],
            hlc: hlc(1_790_000_010_100, DEVICE_A),
          },
        ],
      })
      .expect(201);

    expect(response.body.results[1]).toMatchObject({ card: { evacPriority: 'ROUTINE' } });
    expect(response.body.results[1].conflicts ?? []).toEqual([]);
    expect(await prisma.syncConflict.count({ where: { cardId } })).toBe(0);
  });

  it('replays a mutation whose stored result predates the card schema with the current card', async () => {
    const cardId = newId();
    const mutation = {
      mutationId: newId(),
      cardId,
      op: 'card.upsert',
      baseVersion: null,
      patch: { lastName: 'Tkachenko' },
      changedFields: ['lastName'],
      hlc: hlc(1_790_000_008_000, DEVICE_A),
    };
    const push = () =>
      request(app.getHttpServer()).post('/api/sync/push').send({ deviceId: DEVICE_A, mutations: [mutation] }).expect(201);
    await push();

    // The result as stored before rowDrafts and the paper-card treatment fields existed.
    const stored = await prisma.processedMutation.findUniqueOrThrow({ where: { mutationId: mutation.mutationId } });
    const result = stored.result as { card: Record<string, unknown> };
    const { rowDrafts: _drafts, tqExtremity: _tq, ...oldCard } = result.card;
    await prisma.processedMutation.update({
      where: { mutationId: mutation.mutationId },
      data: { result: { ...result, card: oldCard } as Prisma.InputJsonValue },
    });

    const replay = await push();

    expect(replay.body.results).toEqual([
      expect.objectContaining({
        mutationId: mutation.mutationId,
        status: 'applied',
        card: expect.objectContaining({ id: cardId, lastName: 'Tkachenko', rowDrafts: {}, tqExtremity: false }),
      }),
    ]);
  });

  it('rejects a mutation the database refuses without failing the rest of the batch', async () => {
    const cardId = newId();
    const leftId = newId();
    const rightId = newId();
    const tourniquet = (id: string, limb: string, wall: number) => ({
      mutationId: newId(),
      cardId,
      op: 'child.upsert',
      entity: 'tourniquet',
      baseVersion: null,
      hlc: hlc(wall, DEVICE_A),
      row: {
        id,
        cardId,
        limb,
        type: 'CAT',
        appliedAt: '2026-09-24T12:00:00.000Z',
        clientUpdatedAt: hlc(wall, DEVICE_A),
        deletedAt: null,
      },
    });
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
            patch: { lastName: 'Kovalenko' },
            changedFields: ['lastName'],
            hlc: hlc(1_790_000_009_000, DEVICE_A),
          },
          tourniquet(leftId, 'LEFT_ARM', 1_790_000_009_100),
          tourniquet(rightId, 'RIGHT_ARM', 1_790_000_009_200),
        ],
      })
      .expect(201);

    // Moving the left tourniquet onto the right arm breaks the one-tourniquet-per-limb constraint.
    const response = await request(app.getHttpServer())
      .post('/api/sync/push')
      .send({
        deviceId: DEVICE_A,
        mutations: [
          { ...tourniquet(leftId, 'RIGHT_ARM', 1_790_000_009_300), baseVersion: 3 },
          {
            mutationId: newId(),
            cardId,
            op: 'card.upsert',
            baseVersion: 3,
            patch: { notes: 'TQ on both arms' },
            changedFields: ['notes'],
            hlc: hlc(1_790_000_009_400, DEVICE_A),
          },
        ],
      })
      .expect(201);

    expect(response.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } });
    expect(response.body.results[1]).toMatchObject({ status: 'applied', card: { notes: 'TQ on both arms' } });
    expect(await prisma.tourniquet.findUnique({ where: { id: leftId } })).toMatchObject({ limb: 'LEFT_ARM' });
  });
});
