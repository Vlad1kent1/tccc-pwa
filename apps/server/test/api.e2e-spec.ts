import { Test } from '@nestjs/testing';
import { emptyCardFields, newId, type CasualtyCard } from '@tccc/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/common/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5434/tccc_medical_db';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.API_UNIT_TOKEN = 'api-e2e-unit-token-0001';

const AUTH = `Bearer ${process.env.API_UNIT_TOKEN}`;
const DEVICE = '0192f200-0000-7000-8000-0000000000d1';

function hlc(wall: number): string {
  return `${String(wall).padStart(13, '0')}:0001:${DEVICE}`;
}

function cardBody(id: string, extra: Record<string, unknown> = {}) {
  return { id, createdByDeviceId: DEVICE, ...emptyCardFields(), ...extra };
}

describe('casualties API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const authed = () => request.agent(app.getHttpServer()).set('Authorization', AUTH);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.casualtyCard.deleteMany({ where: { createdByDeviceId: DEVICE } });
    await prisma.device.deleteMany({ where: { id: DEVICE } });
    await app?.close();
  });

  it('reports health with a database check and server time', async () => {
    const response = await authed().get('/api/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(typeof response.body.serverTime).toBe('string');
    expect(Number.isNaN(Date.parse(response.body.serverTime))).toBe(false);
  });

  it('keeps health public and refuses casualty and sync routes without the unit token', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    // Each request is built just before it is sent. supertest starts the server for the
    // first request built and closes it when that request ends, so a request built
    // earlier would find the port closed (ECONNREFUSED).
    const calls = [
      () => request(app.getHttpServer()).get('/api/sync/pull').query({ since: '0' }),
      () => request(app.getHttpServer()).get('/api/casualties'),
      () => request(app.getHttpServer()).post('/api/sync/push').send({ deviceId: DEVICE, mutations: [] }),
    ];
    for (const authorization of [undefined, 'Bearer wrong-token-0000000000', process.env.API_UNIT_TOKEN!]) {
      for (const build of calls) {
        const call = build();
        const response = await (authorization ? call.set('Authorization', authorization) : call).expect(401);
        expect(response.headers['www-authenticate']).toBe('Bearer realm="tccc"');
      }
    }
    await authed().get('/api/sync/pull').query({ since: '0', limit: 1 }).expect(200);
  });

  it('registers a device and refreshes last-seen without clearing a stored label', async () => {
    const first = await authed()
      .post('/api/devices/register')
      .send({ deviceId: DEVICE, label: 'Medic 1' })
      .expect(201);
    expect(first.body).toMatchObject({ deviceId: DEVICE, label: 'Medic 1' });

    const again = await authed().post('/api/devices/register').send({ deviceId: DEVICE }).expect(201);
    expect(again.body.label).toBe('Medic 1');
    expect(Date.parse(again.body.lastSeenAt)).toBeGreaterThanOrEqual(Date.parse(first.body.lastSeenAt));
  });

  it('creates, updates, and soft-deletes a card with child rows and version checks', async () => {
    const id = newId();
    const created = await authed()
      .post('/api/casualties')
      .send(cardBody(id, { lastName: 'Shevchenko', evacPriority: 'ROUTINE' }))
      .expect(201);
    const card = created.body as CasualtyCard;
    expect(card.version).toBe(1);
    expect(card.lastName).toBe('Shevchenko');
    expect(card.changeSeq).toMatch(/^\d+$/);

    const replay = await authed()
      .post('/api/casualties')
      .send(cardBody(id, { lastName: 'Shevchenko', evacPriority: 'ROUTINE' }))
      .expect(201);
    expect(replay.body.version).toBe(1);
    expect(replay.body.changeSeq).toBe(card.changeSeq);

    await authed()
      .post('/api/casualties')
      .send(cardBody(id, { lastName: 'Other' }))
      .expect(409);

    const loaded = await authed().get(`/api/casualties/${id}`).expect(200);
    expect(loaded.body.id).toBe(id);

    const listed = await authed().get('/api/casualties').query({ search: 'Shevchenko', priority: 'ROUTINE' }).expect(200);
    expect(listed.body.items.some((item: { id: string }) => item.id === id)).toBe(true);

    const patched = await authed()
      .patch(`/api/casualties/${id}`)
      .set('If-Match', '1')
      .send({ notes: 'Tourniquet on the right arm' })
      .expect(200);
    expect(patched.body.notes).toBe('Tourniquet on the right arm');
    expect(patched.body.version).toBe(2);
    expect(patched.body.changeSeq).not.toBe(card.changeSeq);

    await authed().patch(`/api/casualties/${id}`).set('If-Match', '1').send({ notes: 'stale' }).expect(412);
    await authed().patch(`/api/casualties/${id}`).send({ notes: 'missing' }).expect(428);

    let version = 2;
    const appliedAt = '2026-09-27T08:00:00.000Z';
    const withTourniquet = await authed()
      .put(`/api/casualties/${id}/tourniquets/RIGHT_ARM`)
      .set('If-Match', String(version))
      .send({ type: 'CAT', appliedAt, clientUpdatedAt: hlc(version) })
      .expect(200);
    version = withTourniquet.body.version;
    expect(withTourniquet.body.tourniquets).toEqual([
      expect.objectContaining({ limb: 'RIGHT_ARM', type: 'CAT', deletedAt: null }),
    ]);

    const injuryId = newId();
    const withInjury = await authed()
      .post(`/api/casualties/${id}/injury-sites`)
      .set('If-Match', String(version))
      .send({
        id: injuryId,
        region: 'RIGHT_ARM',
        view: 'FRONT',
        x: 0.4,
        y: 0.6,
        description: null,
        clientUpdatedAt: hlc(version),
      })
      .expect(201);
    version = withInjury.body.version;
    expect(withInjury.body.injurySites).toHaveLength(1);

    const vitalId = newId();
    const withVitals = await authed()
      .post(`/api/casualties/${id}/vitals`)
      .set('If-Match', String(version))
      .send({
        id: vitalId,
        measuredAt: appliedAt,
        pulseRate: 88,
        pulseLocation: 'radial',
        systolic: 120,
        diastolic: 80,
        respiratoryRate: null,
        spo2: null,
        avpu: 'ALERT',
        painScale: 3,
        clientUpdatedAt: hlc(version),
      })
      .expect(201);
    version = withVitals.body.version;

    const editedVitals = await authed()
      .patch(`/api/casualties/${id}/vitals/${vitalId}`)
      .set('If-Match', String(version))
      .send({ pulseRate: 99, clientUpdatedAt: hlc(version) })
      .expect(200);
    version = editedVitals.body.version;
    expect(editedVitals.body.vitalSigns[0].pulseRate).toBe(99);

    const fluidId = newId();
    const withFluid = await authed()
      .post(`/api/casualties/${id}/fluids`)
      .set('If-Match', String(version))
      .send({
        id: fluidId,
        kind: 'BLOOD_PRODUCT',
        name: 'Whole blood',
        volumeMl: 500,
        route: 'IV',
        administeredAt: appliedAt,
        clientUpdatedAt: hlc(version),
      })
      .expect(201);
    version = withFluid.body.version;

    const medicationId = newId();
    const withMedication = await authed()
      .post(`/api/casualties/${id}/medications`)
      .set('If-Match', String(version))
      .send({
        id: medicationId,
        category: 'ANALGESIC',
        name: 'Ketamine',
        dose: '50 mg',
        route: 'IV',
        administeredAt: appliedAt,
        clientUpdatedAt: hlc(version),
      })
      .expect(201);
    version = withMedication.body.version;
    expect(withMedication.body.medications[0].name).toBe('Ketamine');

    const tombstonedVitals = await authed()
      .delete(`/api/casualties/${id}/vitals/${vitalId}`)
      .set('If-Match', String(version))
      .expect(200);
    version = tombstonedVitals.body.version;
    expect(tombstonedVitals.body.vitalSigns[0].deletedAt).toEqual(expect.any(String));

    const tombstonedTourniquet = await authed()
      .delete(`/api/casualties/${id}/tourniquets/RIGHT_ARM`)
      .set('If-Match', String(version))
      .expect(200);
    version = tombstonedTourniquet.body.version;
    expect(tombstonedTourniquet.body.tourniquets[0].deletedAt).toEqual(expect.any(String));

    await authed().delete(`/api/casualties/${id}/injury-sites/${injuryId}`).set('If-Match', String(version)).expect(200);
    version += 1;
    await authed().delete(`/api/casualties/${id}/fluids/${fluidId}`).set('If-Match', String(version)).expect(200);
    version += 1;
    await authed().delete(`/api/casualties/${id}/medications/${medicationId}`).set('If-Match', String(version)).expect(200);
    version += 1;

    const removed = await authed().delete(`/api/casualties/${id}`).set('If-Match', String(version)).expect(200);
    expect(removed.body.deletedAt).toEqual(expect.any(String));
    expect(removed.body.version).toBe(version + 1);

    const hidden = await authed().get('/api/casualties').query({ search: 'Shevchenko' }).expect(200);
    expect(hidden.body.items.some((item: { id: string }) => item.id === id)).toBe(false);
    const visible = await authed()
      .get('/api/casualties')
      .query({ search: 'Shevchenko', includeDeleted: 'true' })
      .expect(200);
    expect(visible.body.items.some((item: { id: string }) => item.id === id)).toBe(true);
  });

  it('lists every casualties, device, and health route in Swagger', async () => {
    const response = await authed().get('/api/docs-json').expect(200);
    const paths = Object.keys(response.body.paths as Record<string, unknown>);
    for (const path of [
      '/api/health',
      '/api/devices/register',
      '/api/casualties',
      '/api/casualties/{id}',
      '/api/casualties/{id}/tourniquets/{limb}',
      '/api/casualties/{id}/injury-sites',
      '/api/casualties/{id}/injury-sites/{itemId}',
      '/api/casualties/{id}/vitals',
      '/api/casualties/{id}/vitals/{itemId}',
      '/api/casualties/{id}/fluids',
      '/api/casualties/{id}/fluids/{itemId}',
      '/api/casualties/{id}/medications',
      '/api/casualties/{id}/medications/{itemId}',
    ]) {
      expect(paths).toContain(path);
    }
  });
});
