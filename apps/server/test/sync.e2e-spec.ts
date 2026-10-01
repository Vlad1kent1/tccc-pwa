import { Test } from '@nestjs/testing';
import { newId, type CasualtyCard, type MutationResult, type PushResponse } from '@tccc/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe.js';
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

    const resolved = await request(app.getHttpServer())
      .post(`/api/sync/conflicts/${listed.body[0].id}/resolve`)
      .send({ choice: 'discarded' })
      .expect(201);
    expect(resolved.body.card.evacPriority).toBe('URGENT');
    expect(resolved.body.conflict.resolvedBy).toBe('discarded');
    expect(await prisma.syncConflict.count({ where: { cardId } })).toBe(1);
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
});
