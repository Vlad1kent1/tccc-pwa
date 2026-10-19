import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { emptyCardFields, newId, type MutationResult } from '@tccc/shared';
import { Prisma } from '../generated/prisma/client.js';
import { toCardDto, type CardWithChildren } from '../prisma/card-serializer.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SyncService } from './sync.service.js';

const DEVICE = '0192f100-0000-7000-8000-00000000000a';
const ISO = '2026-10-19T12:00:00.000Z';

function known(code: string, message = `Error ${code}`) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
}

function upsert(cardId = newId()) {
  return {
    mutationId: newId(),
    cardId,
    op: 'card.upsert',
    baseVersion: 1,
    patch: { notes: 'Tourniquet checked' },
    changedFields: ['notes'],
    hlc: `1790000000000:0001:${DEVICE}`,
  };
}

function storedCard(id: string): CardWithChildren {
  return {
    id,
    ...emptyCardFields(),
    injurySites: [],
    tourniquets: [],
    vitalSigns: [],
    fluids: [],
    medications: [],
    fieldClock: {},
    version: 3,
    changeSeq: 7n,
    createdByDeviceId: DEVICE,
    createdAt: new Date(ISO),
    serverUpdatedAt: new Date(ISO),
    deletedAt: null,
  } as unknown as CardWithChildren;
}

function applied(mutationId: string): MutationResult {
  return { mutationId, status: 'applied', card: toCardDto(storedCard(newId())) };
}

function serviceWith(stored: { result: unknown } | null = null) {
  const prisma = {
    $transaction: vi.fn(),
    processedMutation: { findUnique: vi.fn(async () => stored) },
  };
  return { service: new SyncService(prisma as unknown as PrismaService), prisma };
}

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncService.push', () => {
  it('retries a deadlock and returns the attempt that succeeds', async () => {
    const mutation = upsert();
    const { service, prisma } = serviceWith();
    prisma.$transaction.mockRejectedValueOnce(known('P2034')).mockResolvedValueOnce(applied(mutation.mutationId));

    const response = await service.push(DEVICE, [mutation]);

    expect(response.results).toEqual([expect.objectContaining({ mutationId: mutation.mutationId, status: 'applied' })]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('fails the push with 503 when the database stays busy, after logging the mutation', async () => {
    const mutation = upsert();
    const { service, prisma } = serviceWith();
    prisma.$transaction.mockRejectedValue(known('P2028', 'Transaction already closed'));

    await expect(service.push(DEVICE, [mutation])).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    const [message, stack] = errorLog.mock.calls[0] as [string, string];
    expect(message).toContain(`Mutation ${mutation.mutationId} from device ${DEVICE} failed after 3 attempt(s)`);
    expect(message).toContain('[P2028]');
    expect(message).toContain(`mutation: ${JSON.stringify(mutation)}`);
    expect(stack).toContain('PrismaClientKnownRequestError');
  });

  it('rejects only the mutation that hit an unexpected error and still applies the next one', async () => {
    const [broken, fine] = [upsert(), upsert()];
    const { service, prisma } = serviceWith();
    prisma.$transaction.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(applied(fine.mutationId));

    const response = await service.push(DEVICE, [broken, fine]);

    expect(response.results).toEqual([
      {
        mutationId: broken.mutationId,
        status: 'rejected',
        error: { code: 'INTERNAL', message: 'Server could not apply the mutation', details: { code: null } },
      },
      expect.objectContaining({ mutationId: fine.mutationId, status: 'applied' }),
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Error: boom'), expect.any(String));
  });

  it('rejects data the database refuses as VALIDATION without retrying it', async () => {
    const mutation = upsert();
    const { service, prisma } = serviceWith();
    prisma.$transaction.mockRejectedValue(known('P2003', 'Foreign key constraint violated'));

    const [result] = (await service.push(DEVICE, [mutation])).results;

    expect(result).toMatchObject({
      mutationId: mutation.mutationId,
      status: 'rejected',
      error: {
        code: 'VALIDATION',
        message: 'Database refused the mutation: Foreign key constraint violated',
        details: { code: 'P2003' },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('answers a duplicate mutation with the result of the request that committed first', async () => {
    const mutation = upsert();
    const first = applied(mutation.mutationId);
    const { service, prisma } = serviceWith({ result: first });
    prisma.$transaction.mockRejectedValue(known('P2002'));

    expect((await service.push(DEVICE, [mutation])).results).toEqual([first]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a unique violation that comes back on the second try', async () => {
    const mutation = upsert();
    const { service, prisma } = serviceWith();
    prisma.$transaction.mockRejectedValue(known('P2002', 'Unique constraint failed on the fields: (`cardId`,`limb`)'));

    const [result] = (await service.push(DEVICE, [mutation])).results;

    expect(result).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('replays a stored result that predates the current card schema with the card as it is now', async () => {
    const mutation = upsert();
    const card = storedCard(mutation.cardId);
    const { rowDrafts: _drafts, tqExtremity: _tq, ...oldShape } = toCardDto(card);
    const conflict = { id: newId(), entity: 'card', entityId: card.id, field: 'notes', kept: 'a', discarded: 'b' };
    const tx = {
      processedMutation: {
        findUnique: vi.fn(async () => ({
          result: { mutationId: mutation.mutationId, status: 'merged', card: oldShape, conflicts: [conflict] },
        })),
      },
      casualtyCard: { findUnique: vi.fn(async () => card) },
    };
    const { service, prisma } = serviceWith();
    prisma.$transaction.mockImplementation((work: (client: unknown) => Promise<unknown>) => work(tx));

    const [result] = (await service.push(DEVICE, [mutation])).results;

    expect(result).toEqual({ mutationId: mutation.mutationId, status: 'merged', card: toCardDto(card), conflicts: [conflict] });
    expect(tx.casualtyCard.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: card.id } }));
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('no longer matches the schema'));
  });
});
