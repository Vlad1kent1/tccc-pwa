import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CARD_FIELDS,
  MUTATION_ERROR_CODES,
  emptyCardFields,
  formatHlc,
  isNewerHlc,
  mutationResultSchema,
  mutationSchema,
  newId,
  parseHlc,
  syncConflictSchema,
  tickHlc,
  type CardField,
  type CasualtyCard,
  type ChildEntity,
  type Mutation,
  type MutationResult,
  type PullResponse,
  type PushResponse,
  type SyncConflictInfo,
} from '@tccc/shared';
import { formatPayload, logError, payloadLoggingEnabled } from '../common/error-log.js';
import { Prisma } from '../generated/prisma/client.js';
import { cardWithChildren, toCardDto, type CardWithChildren } from '../prisma/card-serializer.js';
import { nextChangeSeq } from '../prisma/change-seq.js';
import { classifyDbError, dbErrorLines, describeDbError } from '../prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mergeCardDelete, mergeCardPatch, mergeChildDelete, mergeChildUpsert, type DiscardedValue } from './merge.js';
import type { ListConflictsQuery, ResolveConflict } from './sync.schemas.js';

const SERVER_NODE = 'server';
const NIL_MUTATION_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Interactive transaction limits for one mutation. Prisma's defaults (2 s to start, 5 s in all)
 * are tight for the ~15 queries a mutation runs behind its card lock on a busy database.
 */
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/** Tries per mutation when the database fails transiently (deadlock, timeout, lost connection). */
const MAX_ATTEMPTS = 3;

const CHILD_DELEGATE = {
  injurySite: 'injurySite',
  tourniquet: 'tourniquet',
  vitalSigns: 'vitalSigns',
  fluid: 'fluidAdministration',
  medication: 'medication',
} as const satisfies Record<ChildEntity, string>;

const CHILD_DATE_FIELDS: Record<ChildEntity, readonly string[]> = {
  injurySite: ['deletedAt'],
  tourniquet: ['appliedAt', 'deletedAt'],
  vitalSigns: ['measuredAt', 'deletedAt'],
  fluid: ['administeredAt', 'deletedAt'],
  medication: ['administeredAt', 'deletedAt'],
};

type Tx = Prisma.TransactionClient;

interface StoredChild {
  id: string;
  cardId: string;
  clientUpdatedAt: string;
  deletedAt: Date | null;
  [key: string]: unknown;
}

export interface ConflictRecord {
  id: string;
  cardId: string;
  entity: string;
  entityId: string;
  field: string;
  keptValue: unknown;
  discardedValue: unknown;
  discardedDeviceId: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(deviceId: string, mutations: unknown[]): Promise<PushResponse> {
    const results: MutationResult[] = [];
    for (const raw of mutations) {
      results.push(await this.pushOne(deviceId, raw));
    }
    return { results, serverTime: new Date().toISOString() };
  }

  async pull(since: string, limit: number): Promise<PullResponse> {
    const rows = await this.prisma.casualtyCard.findMany({
      where: { changeSeq: { gt: BigInt(since) } },
      orderBy: { changeSeq: 'asc' },
      take: limit + 1,
      include: cardWithChildren,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextSince = page.at(-1)?.changeSeq.toString() ?? since;
    return {
      cards: page.map((card) => toCardDto(card)),
      nextSince,
      hasMore,
      serverTime: new Date().toISOString(),
    };
  }

  async listConflicts(query: ListConflictsQuery): Promise<ConflictRecord[]> {
    const resolvedAt =
      query.resolved === 'true' ? { not: null } : query.resolved === 'false' ? null : undefined;
    const rows = await this.prisma.syncConflict.findMany({
      where: { cardId: query.cardId, resolvedAt },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toConflictRecord);
  }

  async resolve(id: string, body: ResolveConflict): Promise<{ conflict: ConflictRecord; card: CasualtyCard }> {
    return this.prisma.$transaction(async (tx) => {
      const conflict = await tx.syncConflict.findUnique({ where: { id } });
      if (!conflict) {
        throw new NotFoundException(`Conflict ${id} not found`);
      }
      if (conflict.resolvedAt) {
        throw new ConflictException(`Conflict ${id} is already resolved`);
      }

      await this.lockCard(tx, conflict.cardId);
      const card = await this.loadCard(tx, conflict.cardId);
      if (!card) {
        throw new NotFoundException(`Card ${conflict.cardId} not found`);
      }

      let current = card;
      if (body.choice === 'discarded') {
        current = await this.applyDiscarded(tx, card, conflict);
      }

      const resolved = await tx.syncConflict.update({
        where: { id },
        data: { resolvedAt: new Date(), resolvedBy: body.choice },
      });
      const fresh = body.choice === 'discarded' ? current : await this.loadCard(tx, card.id);
      return { conflict: toConflictRecord(resolved), card: toCardDto(fresh ?? current) };
    }, TX_OPTIONS);
  }

  /**
   * Applies one mutation in its own transaction. A transient database failure is retried and,
   * if it lasts, fails the request with 503 so the device retries later; the mutations before it
   * stay committed and replay from `ProcessedMutation`. Any other failure rejects only this
   * mutation, so one bad mutation never holds up the rest of the outbox.
   */
  private async pushOne(deviceId: string, raw: unknown): Promise<MutationResult> {
    const claimedId = readMutationId(raw);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => this.applyInTransaction(tx, deviceId, raw), TX_OPTIONS);
      } catch (error) {
        if (error instanceof HttpException) throw error;
        // A concurrent request for the same mutation committed first: answer with its result.
        if (isUniqueViolation(error) && claimedId) {
          const stored = await this.prisma.processedMutation.findUnique({ where: { mutationId: claimedId } });
          if (stored) return this.replayStored(this.prisma, stored.result, claimedId, raw);
        }
        const kind = classifyDbError(error);
        // Without a stored result a unique violation gets one more try: a card that a concurrent
        // mutation created is found then.
        const retry = kind === 'transient' || (kind === 'unique' && attempt === 1);
        if (!retry || attempt >= MAX_ATTEMPTS) {
          return this.failMutation(deviceId, raw, claimedId, error, attempt);
        }
        await sleep(retryDelayMs(attempt));
      }
    }
  }

  /**
   * Logs a mutation the server could not apply with the exact payload, then rejects it: as
   * VALIDATION when the database refused the data, as INTERNAL otherwise. A failure that a later
   * retry may get past fails the whole push with 503 instead.
   */
  private failMutation(
    deviceId: string,
    raw: unknown,
    claimedId: string | null,
    error: unknown,
    attempts: number,
  ): MutationResult {
    const db = describeDbError(error);
    const mutationId = claimedId ?? NIL_MUTATION_ID;
    const [headline, ...details] = dbErrorLines(db);
    logError(
      this.logger,
      [
        `Mutation ${mutationId} from device ${deviceId} failed after ${attempts} attempt(s): ${headline}`,
        ...details,
        ...(payloadLoggingEnabled() ? [`mutation: ${formatPayload(raw)}`] : []),
      ],
      error,
    );
    if (db.kind === 'transient') {
      throw new ServiceUnavailableException('The database is busy, retry the push');
    }
    if (db.kind === 'invalid-data' || db.kind === 'unique') {
      return rejectedResult(mutationId, 'VALIDATION', `Database refused the mutation: ${db.summary}`, {
        code: db.code,
        sqlState: db.sqlState,
        ...db.detail,
      });
    }
    return rejectedResult(mutationId, 'INTERNAL', 'Server could not apply the mutation', { code: db.code });
  }

  /**
   * The stored result of a mutation that was already applied. A result stored before the card
   * schema gained fields no longer parses; the mutation is applied all the same, so the reply then
   * carries the card as it is now instead of failing every retry of that mutation.
   */
  private async replayStored(
    client: Tx,
    stored: Prisma.JsonValue,
    mutationId: string,
    raw: unknown,
  ): Promise<MutationResult> {
    const value = stripConflictsWithoutIds(stored);
    const parsed = mutationResultSchema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    this.logger.warn(
      `Stored result of mutation ${mutationId} no longer matches the schema; replying with the current card. ` +
        `Issues: ${formatPayload(parsed.error.issues, 2_000)}`,
    );

    const record = isRecord(value) ? value : {};
    if (record.status === 'rejected') {
      const error = isRecord(record.error) ? record.error : {};
      const code = MUTATION_ERROR_CODES.find((item) => item === error.code) ?? 'INTERNAL';
      return rejectedResult(mutationId, code, typeof error.message === 'string' ? error.message : 'Mutation was rejected');
    }
    const storedCard = isRecord(record.card) ? record.card : {};
    const cardId = typeof storedCard.id === 'string' ? storedCard.id : readField(raw, 'cardId');
    const card = cardId ? await this.loadCard(client, cardId) : null;
    if (!card) {
      return rejectedResult(mutationId, 'NOT_FOUND', `Card ${cardId ?? '(unknown)'} not found`);
    }
    if (record.status === 'merged') {
      const conflicts = (Array.isArray(record.conflicts) ? record.conflicts : []).flatMap((item) => {
        const conflict = syncConflictSchema.safeParse(item);
        return conflict.success ? [conflict.data] : [];
      });
      return { mutationId, status: 'merged', card: toCardDto(card), conflicts };
    }
    return { mutationId, status: 'applied', card: toCardDto(card) };
  }

  private async applyInTransaction(tx: Tx, deviceId: string, raw: unknown): Promise<MutationResult> {
    const claimedId = readMutationId(raw);
    if (claimedId) {
      const existing = await tx.processedMutation.findUnique({ where: { mutationId: claimedId } });
      if (existing) {
        return this.replayStored(tx, existing.result, claimedId, raw);
      }
    }

    const parsed = mutationSchema.safeParse(raw);
    if (!parsed.success) {
      const mutationId = claimedId ?? '00000000-0000-0000-0000-000000000000';
      const rejected = rejectedResult(mutationId, 'VALIDATION', 'Mutation failed validation', parsed.error.issues);
      if (claimedId) {
        await this.remember(tx, deviceId, claimedId, rejected);
      }
      return rejected;
    }

    const mutation = parsed.data;
    await this.lockCard(tx, mutation.cardId);
    const card = await this.loadCard(tx, mutation.cardId);
    const outcome = await this.applyMutation(tx, deviceId, mutation, card);
    await this.touchDevice(tx, deviceId);
    await this.remember(tx, deviceId, mutation.mutationId, outcome);
    return outcome;
  }

  private async applyMutation(
    tx: Tx,
    deviceId: string,
    mutation: Mutation,
    card: CardWithChildren | null,
  ): Promise<MutationResult> {
    if (!card) {
      if (mutation.op === 'card.upsert') {
        const created = await this.createCard(tx, deviceId, mutation);
        return { mutationId: mutation.mutationId, status: 'applied', card: toCardDto(created) };
      }
      return rejectedResult(mutation.mutationId, 'NOT_FOUND', `Card ${mutation.cardId} not found`);
    }

    // Every op merges by clock. A matching base version only decides whether a replaced value is a conflict.
    const fastPath = mutation.baseVersion === card.version;
    if (mutation.op === 'card.upsert') {
      return this.applyCardUpsert(tx, deviceId, mutation, card, fastPath);
    }
    if (mutation.op === 'card.delete') {
      return this.applyCardDelete(tx, deviceId, mutation, card, fastPath);
    }
    if (mutation.op === 'child.upsert') {
      return this.applyChildUpsert(tx, deviceId, mutation, card, fastPath);
    }
    return this.applyChildDelete(tx, deviceId, mutation, card, fastPath);
  }

  private async createCard(
    tx: Tx,
    deviceId: string,
    mutation: Extract<Mutation, { op: 'card.upsert' }>,
  ): Promise<CardWithChildren> {
    const scalars = emptyCardFields();
    const clock: Record<string, string> = {};
    for (const field of mutation.changedFields) {
      scalars[field] = mutation.patch[field] as never;
      clock[field] = mutation.hlc;
    }
    return tx.casualtyCard.create({
      data: {
        id: mutation.cardId,
        ...toCardColumns(scalars),
        fieldClock: clock,
        version: 1,
        changeSeq: await nextChangeSeq(tx),
        createdByDeviceId: deviceId,
      },
      include: cardWithChildren,
    });
  }

  private async applyCardUpsert(
    tx: Tx,
    deviceId: string,
    mutation: Extract<Mutation, { op: 'card.upsert' }>,
    card: CardWithChildren,
    fastPath: boolean,
  ): Promise<MutationResult> {
    const dto = toCardDto(card);
    const { columns, clock, discarded } = mergeCardPatch({
      cardId: card.id,
      stored: dto,
      storedClock: dto.fieldClock,
      patch: mutation.patch,
      changedFields: mutation.changedFields,
      hlc: mutation.hlc,
      fastPath,
    });
    const saved = await this.saveCard(tx, card, columns, clock);
    const conflicts = await this.persistConflicts(tx, deviceId, card.createdByDeviceId, saved.id, discarded);
    return resultOf(mutation.mutationId, fastPath, toCardDto(saved), conflicts);
  }

  private async applyCardDelete(
    tx: Tx,
    deviceId: string,
    mutation: Extract<Mutation, { op: 'card.delete' }>,
    card: CardWithChildren,
    fastPath: boolean,
  ): Promise<MutationResult> {
    const dto = toCardDto(card);
    const { deletedAt, clock, discarded } = mergeCardDelete({
      cardId: card.id,
      storedDeletedAt: dto.deletedAt,
      storedClock: dto.fieldClock,
      deletedAt: mutation.deletedAt,
      hlc: mutation.hlc,
      fastPath,
    });

    const saved = await tx.casualtyCard.update({
      where: { id: card.id },
      data: {
        deletedAt: deletedAt ? new Date(deletedAt) : null,
        fieldClock: clock,
        version: card.version + 1,
        changeSeq: await nextChangeSeq(tx),
      },
      include: cardWithChildren,
    });
    const conflicts = await this.persistConflicts(tx, deviceId, card.createdByDeviceId, saved.id, discarded);
    return resultOf(mutation.mutationId, fastPath, toCardDto(saved), conflicts);
  }

  private async applyChildUpsert(
    tx: Tx,
    deviceId: string,
    mutation: Extract<Mutation, { op: 'child.upsert' }>,
    card: CardWithChildren,
    fastPath: boolean,
  ): Promise<MutationResult> {
    const stored = await this.findChild(tx, mutation.entity, card.id, mutation.row);
    if (stored && stored.cardId !== card.id) {
      return rejectedResult(mutation.mutationId, 'VALIDATION', 'Child row belongs to another card');
    }

    const incoming = wireChild(mutation.entity, mutation.row as unknown as Record<string, unknown>);
    const { write, discarded } = mergeChildUpsert({
      entity: mutation.entity,
      stored: stored ? wireChild(mutation.entity, stored) : null,
      incoming,
      fastPath,
    });
    if (write) {
      await this.writeChild(tx, mutation.entity, stored ? { ...write, id: stored.id } : write);
    }

    const saved = await this.bumpCard(tx, card);
    const conflicts = await this.persistConflicts(tx, deviceId, card.createdByDeviceId, saved.id, discarded);
    return resultOf(mutation.mutationId, fastPath, toCardDto(saved), conflicts);
  }

  private async applyChildDelete(
    tx: Tx,
    deviceId: string,
    mutation: Extract<Mutation, { op: 'child.delete' }>,
    card: CardWithChildren,
    fastPath: boolean,
  ): Promise<MutationResult> {
    const stored = await this.findChildById(tx, mutation.entity, mutation.entityId);
    if (!stored || stored.cardId !== card.id) {
      return rejectedResult(mutation.mutationId, 'NOT_FOUND', `Child row ${mutation.entityId} not found`);
    }

    const { write, discarded } = mergeChildDelete({
      entity: mutation.entity,
      stored: wireChild(mutation.entity, stored),
      deletedAt: mutation.deletedAt,
      hlc: mutation.hlc,
      fastPath,
    });
    if (write) {
      await this.writeChild(tx, mutation.entity, write);
    }

    const saved = await this.bumpCard(tx, card);
    const conflicts = await this.persistConflicts(tx, deviceId, card.createdByDeviceId, saved.id, discarded);
    return resultOf(mutation.mutationId, fastPath, toCardDto(saved), conflicts);
  }

  private async applyDiscarded(
    tx: Tx,
    card: CardWithChildren,
    conflict: { entity: string; entityId: string; field: string; discardedValue: Prisma.JsonValue },
  ): Promise<CardWithChildren> {
    const dto = toCardDto(card);
    const value = conflict.discardedValue === null ? null : conflict.discardedValue;

    if (conflict.entity === 'card') {
      const field = conflict.field;
      const clock = { ...dto.fieldClock, [field]: newerThan(dto.fieldClock[field]) };
      if (field === 'deletedAt') {
        return tx.casualtyCard.update({
          where: { id: card.id },
          data: {
            deletedAt: typeof value === 'string' ? new Date(value) : null,
            fieldClock: clock,
            version: card.version + 1,
            changeSeq: await nextChangeSeq(tx),
          },
          include: cardWithChildren,
        });
      }
      if (!isCardField(field)) {
        throw new ConflictException(`Conflict field ${field} is not a card field`);
      }
      return this.saveCard(tx, card, { [field]: value }, clock);
    }

    const entity = conflict.entity as ChildEntity;
    if (conflict.field === 'row' && value && typeof value === 'object') {
      const row = value as Record<string, unknown>;
      row.clientUpdatedAt = newerThan(typeof row.clientUpdatedAt === 'string' ? row.clientUpdatedAt : null);
      await this.writeChild(tx, entity, row);
      return this.bumpCard(tx, card);
    }
    if (conflict.field === 'deletedAt') {
      const stored = await this.findChildById(tx, entity, conflict.entityId);
      if (!stored) {
        throw new NotFoundException(`Child row ${conflict.entityId} not found`);
      }
      const wire = wireChild(entity, stored);
      wire.deletedAt = typeof value === 'string' ? value : null;
      wire.clientUpdatedAt = newerThan(wire.clientUpdatedAt);
      await this.writeChild(tx, entity, wire);
      return this.bumpCard(tx, card);
    }
    throw new ConflictException(`Cannot apply discarded field ${conflict.field}`);
  }

  private async saveCard(
    tx: Tx,
    card: CardWithChildren,
    columns: Partial<Record<CardField, unknown>>,
    fieldClock: Record<string, string>,
  ): Promise<CardWithChildren> {
    const data: Record<string, unknown> = {
      fieldClock,
      version: card.version + 1,
      changeSeq: await nextChangeSeq(tx),
    };
    for (const [field, value] of Object.entries(columns)) {
      data[field] = field === 'injuredAt' && typeof value === 'string' ? new Date(value) : value;
    }
    return tx.casualtyCard.update({
      where: { id: card.id },
      data,
      include: cardWithChildren,
    });
  }

  private async bumpCard(tx: Tx, card: CardWithChildren): Promise<CardWithChildren> {
    return tx.casualtyCard.update({
      where: { id: card.id },
      data: { version: card.version + 1, changeSeq: await nextChangeSeq(tx) },
      include: cardWithChildren,
    });
  }

  private async persistConflicts(
    tx: Tx,
    deviceId: string,
    createdByDeviceId: string,
    cardId: string,
    discarded: DiscardedValue[],
  ): Promise<SyncConflictInfo[]> {
    if (discarded.length === 0) {
      return [];
    }
    const rows = discarded.map((item) => ({
      id: newId(),
      cardId,
      entity: item.entity,
      entityId: item.entityId,
      field: item.field,
      keptValue: toJson(item.kept),
      discardedValue: toJson(item.discarded),
      discardedDeviceId: item.incomingLost ? deviceId : createdByDeviceId,
    }));
    await tx.syncConflict.createMany({ data: rows });
    return rows.flatMap((row, index) => {
      const item = discarded[index];
      if (!item) return [];
      return [
        {
          id: row.id,
          entity: item.entity,
          entityId: item.entityId,
          field: item.field,
          kept: item.kept,
          discarded: item.discarded,
        },
      ];
    });
  }

  private async remember(tx: Tx, deviceId: string, mutationId: string, result: MutationResult): Promise<void> {
    await tx.processedMutation.create({
      data: { mutationId, deviceId, result: toJson(result) },
    });
  }

  private async touchDevice(tx: Tx, deviceId: string): Promise<void> {
    const now = new Date();
    await tx.device.upsert({
      where: { id: deviceId },
      create: { id: deviceId, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
  }

  private async lockCard(tx: Tx, cardId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "CasualtyCard" WHERE id = ${cardId}::uuid FOR UPDATE`;
  }

  private loadCard(tx: Tx, cardId: string): Promise<CardWithChildren | null> {
    return tx.casualtyCard.findUnique({ where: { id: cardId }, include: cardWithChildren });
  }

  private async findChild(
    tx: Tx,
    entity: ChildEntity,
    cardId: string,
    row: { id: string; limb?: string },
  ): Promise<StoredChild | null> {
    const byId = await this.findChildById(tx, entity, row.id);
    if (byId) {
      return byId;
    }
    if (entity === 'tourniquet' && row.limb) {
      const found = await tx.tourniquet.findUnique({
        where: { cardId_limb: { cardId, limb: row.limb as never } },
      });
      return found as StoredChild | null;
    }
    return null;
  }

  private async findChildById(tx: Tx, entity: ChildEntity, id: string): Promise<StoredChild | null> {
    const delegate = childDelegate(tx, entity);
    const found = await delegate.findUnique({ where: { id } });
    return found as StoredChild | null;
  }

  private async writeChild(tx: Tx, entity: ChildEntity, row: Record<string, unknown>): Promise<void> {
    const data = toChildColumns(entity, row);
    const id = String(row.id);
    const delegate = childDelegate(tx, entity);
    const { id: _id, ...update } = data;
    await delegate.upsert({
      where: { id },
      create: data,
      update,
    });
  }
}

function childDelegate(tx: Tx, entity: ChildEntity): {
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  upsert: (args: { where: { id: string }; create: object; update: object }) => Promise<unknown>;
} {
  return tx[CHILD_DELEGATE[entity]] as never;
}

function toCardColumns(fields: ReturnType<typeof emptyCardFields>): Record<string, unknown> {
  return {
    ...fields,
    injuredAt: fields.injuredAt ? new Date(fields.injuredAt) : null,
  };
}

function toChildColumns(entity: ChildEntity, row: Record<string, unknown>): Record<string, unknown> {
  const data = { ...row };
  for (const field of CHILD_DATE_FIELDS[entity]) {
    const value = data[field];
    if (typeof value === 'string') {
      data[field] = new Date(value);
    }
  }
  return data;
}

function wireChild(entity: ChildEntity, row: Record<string, unknown>): Record<string, unknown> & {
  id: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
} {
  const data: Record<string, unknown> = { ...row };
  for (const field of CHILD_DATE_FIELDS[entity]) {
    const value = data[field];
    if (value instanceof Date) {
      data[field] = value.toISOString();
    }
  }
  delete data.card;
  return data as { id: string; clientUpdatedAt: string; deletedAt: string | null };
}

/**
 * `applied` when the device had seen the stored version and nothing it sent was
 * dropped; `merged` otherwise, with the conflicts to review.
 */
function resultOf(
  mutationId: string,
  fastPath: boolean,
  card: CasualtyCard,
  conflicts: SyncConflictInfo[],
): MutationResult {
  if (fastPath && conflicts.length === 0) {
    return { mutationId, status: 'applied', card };
  }
  return { mutationId, status: 'merged', card, conflicts };
}

function rejectedResult(
  mutationId: string,
  code: 'VALIDATION' | 'NOT_FOUND' | 'INTERNAL',
  message: string,
  details?: unknown,
): MutationResult {
  return { mutationId, status: 'rejected', error: { code, message, details } };
}

function readMutationId(raw: unknown): string | null {
  return readField(raw, 'mutationId');
}

function readField(raw: unknown, key: string): string | null {
  const value = isRecord(raw) ? raw[key] : undefined;
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 50 ms, then 100 ms, plus up to 50 ms of jitter so concurrent retries do not collide again. */
function retryDelayMs(attempt: number): number {
  return 50 * 2 ** (attempt - 1) + Math.floor(Math.random() * 50);
}

/** Replay of a mutation stored before conflict ids existed still returns the card. */
function stripConflictsWithoutIds(value: Prisma.JsonValue): Prisma.JsonValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.status !== 'merged' || !Array.isArray(record.conflicts)) return value;
  return {
    ...record,
    conflicts: record.conflicts.filter((item) => {
      return typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string';
    }),
  } as Prisma.JsonValue;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isCardField(field: string): field is CardField {
  return (CARD_FIELDS as readonly string[]).includes(field);
}

function newerThan(current: string | null | undefined): string {
  const now = Date.now();
  let state = tickHlc({ wallTime: 0, counter: 0, nodeId: SERVER_NODE }, now);
  let formatted = formatHlc(state);
  if (current && !isNewerHlc(formatted, current)) {
    const parsed = parseHlc(current);
    state = tickHlc(
      { wallTime: parsed.wallTime, counter: parsed.counter, nodeId: SERVER_NODE },
      parsed.wallTime,
    );
    formatted = formatHlc(state);
    if (!isNewerHlc(formatted, current)) {
      const counter = parsed.counter >= 9999 ? 0 : parsed.counter + 1;
      const wallTime = parsed.counter >= 9999 ? parsed.wallTime + 1 : parsed.wallTime;
      formatted = formatHlc({ wallTime, counter, nodeId: SERVER_NODE });
    }
  }
  return formatted;
}

function toConflictRecord(row: {
  id: string;
  cardId: string;
  entity: string;
  entityId: string;
  field: string;
  keptValue: Prisma.JsonValue;
  discardedValue: Prisma.JsonValue;
  discardedDeviceId: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}): ConflictRecord {
  return {
    id: row.id,
    cardId: row.cardId,
    entity: row.entity,
    entityId: row.entityId,
    field: row.field,
    keptValue: row.keptValue,
    discardedValue: row.discardedValue,
    discardedDeviceId: row.discardedDeviceId,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedBy: row.resolvedBy,
  };
}
