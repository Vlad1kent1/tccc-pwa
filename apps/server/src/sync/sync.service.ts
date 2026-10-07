import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CARD_FIELDS,
  emptyCardFields,
  formatHlc,
  isNewerHlc,
  mutationResultSchema,
  mutationSchema,
  newId,
  parseHlc,
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
import { Prisma } from '../generated/prisma/client.js';
import { cardWithChildren, toCardDto, type CardWithChildren } from '../prisma/card-serializer.js';
import { nextChangeSeq } from '../prisma/change-seq.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mergeChildRow, mergeField, mergeTombstone, type DiscardedValue } from './merge.js';
import type { ListConflictsQuery, ResolveConflict } from './sync.schemas.js';

const SERVER_NODE = 'server';

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
    });
  }

  private async pushOne(deviceId: string, raw: unknown): Promise<MutationResult> {
    const claimedId = readMutationId(raw);
    try {
      return await this.prisma.$transaction((tx) => this.applyInTransaction(tx, deviceId, raw));
    } catch (error) {
      if (!isUniqueViolation(error) || !claimedId) {
        throw error;
      }
      const stored = await this.prisma.processedMutation.findUnique({
        where: { mutationId: claimedId },
      });
      if (stored) {
        return readStoredResult(stored.result);
      }
      return this.prisma.$transaction((tx) => this.applyInTransaction(tx, deviceId, raw));
    }
  }

  private async applyInTransaction(tx: Tx, deviceId: string, raw: unknown): Promise<MutationResult> {
    const claimedId = readMutationId(raw);
    if (claimedId) {
      const existing = await tx.processedMutation.findUnique({ where: { mutationId: claimedId } });
      if (existing) {
        return readStoredResult(existing.result);
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
    const clock = { ...dto.fieldClock };
    const discarded: DiscardedValue[] = [];
    const columns: Partial<Record<CardField, unknown>> = {};

    for (const field of mutation.changedFields) {
      const incoming = mutation.patch[field];
      if (fastPath) {
        columns[field] = incoming;
        clock[field] = mutation.hlc;
        continue;
      }
      const merged = mergeField({
        entity: 'card',
        entityId: card.id,
        field,
        stored: dto[field],
        incoming,
        storedClock: clock[field],
        incomingClock: mutation.hlc,
      });
      if (isNewerHlc(merged.clock, clock[field])) {
        columns[field] = merged.value;
        clock[field] = merged.clock;
      }
      if (merged.discarded) {
        discarded.push(merged.discarded);
      }
    }

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
    const clock = { ...dto.fieldClock };
    let deletedAt = dto.deletedAt;
    const discarded: DiscardedValue[] = [];

    if (fastPath) {
      deletedAt = mutation.deletedAt;
      clock.deletedAt = mutation.hlc;
    } else {
      const merged = mergeField({
        entity: 'card',
        entityId: card.id,
        field: 'deletedAt',
        stored: dto.deletedAt,
        incoming: mutation.deletedAt,
        storedClock: clock.deletedAt,
        incomingClock: mutation.hlc,
      });
      deletedAt = merged.value as string | null;
      clock.deletedAt = merged.clock;
      if (merged.discarded) {
        discarded.push(merged.discarded);
      }
    }

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
    const storedWire = stored ? wireChild(mutation.entity, stored) : null;
    const merged = fastPath
      ? { row: incoming, discarded: null }
      : mergeChildRow({ entity: mutation.entity, stored: storedWire, incoming });
    const incomingWins = !storedWire || merged.row.clientUpdatedAt === incoming.clientUpdatedAt;

    if (incomingWins) {
      await this.writeChild(tx, mutation.entity, stored ? { ...merged.row, id: stored.id } : merged.row);
    }

    const discarded = merged.discarded ? [merged.discarded] : [];
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

    const storedWire = wireChild(mutation.entity, stored);
    const merged = fastPath
      ? {
          row: { ...storedWire, deletedAt: mutation.deletedAt, clientUpdatedAt: mutation.hlc },
          discarded: null,
        }
      : mergeTombstone({
          entity: mutation.entity,
          stored: storedWire,
          deletedAt: mutation.deletedAt,
          hlc: mutation.hlc,
        });

    if (merged.row.deletedAt !== storedWire.deletedAt || merged.row.clientUpdatedAt !== storedWire.clientUpdatedAt) {
      await this.writeChild(tx, mutation.entity, merged.row);
    }

    const discarded = merged.discarded ? [merged.discarded] : [];
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

function resultOf(
  mutationId: string,
  fastPath: boolean,
  card: CasualtyCard,
  conflicts: SyncConflictInfo[],
): MutationResult {
  if (fastPath) {
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
  if (typeof raw === 'object' && raw !== null && 'mutationId' in raw) {
    const id = (raw as { mutationId?: unknown }).mutationId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function readStoredResult(value: Prisma.JsonValue): MutationResult {
  const parsed = mutationResultSchema.safeParse(stripConflictsWithoutIds(value));
  if (!parsed.success) {
    throw new Error('Stored mutation result is invalid');
  }
  return parsed.data;
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
