import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CARD_FIELDS,
  Limb,
  tourniquetId,
  type CardFields,
  type CardPatch,
  type CasualtyCard,
} from '@tccc/shared';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { assertVersion } from '../common/if-match.js';
import { cardWithChildren, toCardDto, type CardWithChildren } from '../prisma/card-serializer.js';
import { nextChangeSeq } from '../prisma/change-seq.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCasualty,
  CreateFluid,
  CreateInjurySite,
  CreateMedication,
  CreateVitalSigns,
  ListCasualtiesQuery,
  PatchFluid,
  PatchInjurySite,
  PatchMedication,
  PatchVitalSigns,
  UpsertTourniquet,
} from './casualty.schemas.js';

export interface CasualtySummary {
  id: string;
  lastName: string | null;
  firstName: string | null;
  evacPriority: string | null;
  battleRosterNumber: string | null;
  version: number;
  changeSeq: string;
  serverUpdatedAt: string;
  deletedAt: string | null;
}

export interface CasualtyList {
  items: CasualtySummary[];
  nextCursor: string | null;
}

type Tx = Prisma.TransactionClient;
type Write = 'bump' | 'keep';

@Injectable()
export class CasualtiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCasualtiesQuery): Promise<CasualtyList> {
    const limit = query.limit ?? 50;
    const where: Prisma.CasualtyCardWhereInput = {};
    if (query.includeDeleted !== 'true') where.deletedAt = null;
    if (query.priority) where.evacPriority = query.priority;
    if (query.updatedSince) where.serverUpdatedAt = { gte: new Date(query.updatedSince) };
    if (query.cursor) where.changeSeq = { gt: BigInt(query.cursor) };
    if (query.search) {
      where.OR = [
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { battleRosterNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.casualtyCard.findMany({
      where,
      orderBy: { changeSeq: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        lastName: true,
        firstName: true,
        evacPriority: true,
        battleRosterNumber: true,
        version: true,
        changeSeq: true,
        serverUpdatedAt: true,
        deletedAt: true,
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        lastName: row.lastName,
        firstName: row.firstName,
        evacPriority: row.evacPriority,
        battleRosterNumber: row.battleRosterNumber,
        version: row.version,
        changeSeq: row.changeSeq.toString(),
        serverUpdatedAt: row.serverUpdatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.changeSeq.toString() : null,
    };
  }

  async get(id: string): Promise<CasualtyCard> {
    const card = await this.prisma.casualtyCard.findUnique({ where: { id }, include: cardWithChildren });
    if (!card) throw new NotFoundException(`Casualty ${id} not found`);
    return toCardDto(card);
  }

  async create(input: CreateCasualty): Promise<CasualtyCard> {
    const existing = await this.prisma.casualtyCard.findUnique({
      where: { id: input.id },
      include: cardWithChildren,
    });
    if (existing) return this.replay(existing, input);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        return tx.casualtyCard.create({
          data: {
            ...toCardColumns(fieldsOf(input)),
            id: input.id,
            fieldClock: input.fieldClock ?? {},
            version: 1,
            changeSeq: await nextChangeSeq(tx),
            createdByDeviceId: input.createdByDeviceId,
          } as Prisma.CasualtyCardUncheckedCreateInput,
          include: cardWithChildren,
        });
      });
      return toCardDto(created);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.prisma.casualtyCard.findUnique({
        where: { id: input.id },
        include: cardWithChildren,
      });
      if (raced) return this.replay(raced, input);
      throw error;
    }
  }

  async update(id: string, expectedVersion: number, patch: CardPatch): Promise<CasualtyCard> {
    return this.withCard(id, expectedVersion, async (tx) => {
      await tx.casualtyCard.update({ where: { id }, data: toCardColumns(patch) as Prisma.CasualtyCardUpdateInput });
      return 'bump';
    });
  }

  async softDelete(id: string, expectedVersion: number): Promise<CasualtyCard> {
    return this.withCard(id, expectedVersion, async (tx, card) => {
      if (card.deletedAt) return 'keep';
      await tx.casualtyCard.update({ where: { id }, data: { deletedAt: new Date() } });
      return 'bump';
    }, { allowDeleted: true });
  }

  async upsertTourniquet(id: string, limbParam: string, expectedVersion: number, body: UpsertTourniquet): Promise<CasualtyCard> {
    const limb = parseLimb(limbParam);
    return this.withCard(id, expectedVersion, async (tx) => {
      const rowId = tourniquetId(id, limb);
      await tx.tourniquet.upsert({
        where: { id: rowId },
        create: {
          id: rowId,
          cardId: id,
          limb,
          type: body.type,
          appliedAt: new Date(body.appliedAt),
          clientUpdatedAt: body.clientUpdatedAt,
        },
        update: {
          type: body.type,
          appliedAt: new Date(body.appliedAt),
          clientUpdatedAt: body.clientUpdatedAt,
          deletedAt: null,
        },
      });
      return 'bump';
    });
  }

  async deleteTourniquet(id: string, limbParam: string, expectedVersion: number): Promise<CasualtyCard> {
    const limb = parseLimb(limbParam);
    return this.withCard(id, expectedVersion, async (tx) => {
      const row = await tx.tourniquet.findUnique({ where: { cardId_limb: { cardId: id, limb } } });
      if (!row) throw new NotFoundException(`Tourniquet ${limb} not found`);
      if (row.deletedAt) return 'keep';
      await tx.tourniquet.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      return 'bump';
    });
  }

  addInjurySite(id: string, expectedVersion: number, body: CreateInjurySite): Promise<CasualtyCard> {
    return this.addChild(
      id,
      expectedVersion,
      () => this.prisma.injurySite.findUnique({ where: { id: body.id } }),
      (tx) => tx.injurySite.create({ data: { ...body, cardId: id } as Prisma.InjurySiteUncheckedCreateInput }),
    );
  }

  patchInjurySite(id: string, itemId: string, expectedVersion: number, body: PatchInjurySite): Promise<CasualtyCard> {
    return this.patchChild(id, itemId, expectedVersion, (tx) => tx.injurySite.findUnique({ where: { id: itemId } }), (tx) =>
      tx.injurySite.update({ where: { id: itemId }, data: body as Prisma.InjurySiteUncheckedUpdateInput }),
    );
  }

  deleteInjurySite(id: string, itemId: string, expectedVersion: number): Promise<CasualtyCard> {
    return this.tombstoneChild(id, itemId, expectedVersion, (tx) => tx.injurySite.findUnique({ where: { id: itemId } }), (tx, at) =>
      tx.injurySite.update({ where: { id: itemId }, data: { deletedAt: at } }),
    );
  }

  addVitalSigns(id: string, expectedVersion: number, body: CreateVitalSigns): Promise<CasualtyCard> {
    return this.addChild(id, expectedVersion, () => this.prisma.vitalSigns.findUnique({ where: { id: body.id } }), (tx) =>
      tx.vitalSigns.create({
        data: { ...body, cardId: id, measuredAt: new Date(body.measuredAt) } as Prisma.VitalSignsUncheckedCreateInput,
      }),
    );
  }

  patchVitalSigns(id: string, itemId: string, expectedVersion: number, body: PatchVitalSigns): Promise<CasualtyCard> {
    return this.patchChild(id, itemId, expectedVersion, (tx) => tx.vitalSigns.findUnique({ where: { id: itemId } }), (tx) =>
      tx.vitalSigns.update({
        where: { id: itemId },
        data: {
          ...body,
          ...(body.measuredAt !== undefined ? { measuredAt: new Date(body.measuredAt) } : {}),
        } as Prisma.VitalSignsUncheckedUpdateInput,
      }),
    );
  }

  deleteVitalSigns(id: string, itemId: string, expectedVersion: number): Promise<CasualtyCard> {
    return this.tombstoneChild(id, itemId, expectedVersion, (tx) => tx.vitalSigns.findUnique({ where: { id: itemId } }), (tx, at) =>
      tx.vitalSigns.update({ where: { id: itemId }, data: { deletedAt: at } }),
    );
  }

  addFluid(id: string, expectedVersion: number, body: CreateFluid): Promise<CasualtyCard> {
    return this.addChild(id, expectedVersion, () => this.prisma.fluidAdministration.findUnique({ where: { id: body.id } }), (tx) =>
      tx.fluidAdministration.create({
        data: {
          ...body,
          cardId: id,
          administeredAt: new Date(body.administeredAt),
        } as Prisma.FluidAdministrationUncheckedCreateInput,
      }),
    );
  }

  patchFluid(id: string, itemId: string, expectedVersion: number, body: PatchFluid): Promise<CasualtyCard> {
    return this.patchChild(
      id,
      itemId,
      expectedVersion,
      (tx) => tx.fluidAdministration.findUnique({ where: { id: itemId } }),
      (tx) =>
        tx.fluidAdministration.update({
          where: { id: itemId },
          data: {
            ...body,
            ...(body.administeredAt !== undefined ? { administeredAt: new Date(body.administeredAt) } : {}),
          } as Prisma.FluidAdministrationUncheckedUpdateInput,
        }),
    );
  }

  deleteFluid(id: string, itemId: string, expectedVersion: number): Promise<CasualtyCard> {
    return this.tombstoneChild(
      id,
      itemId,
      expectedVersion,
      (tx) => tx.fluidAdministration.findUnique({ where: { id: itemId } }),
      (tx, at) => tx.fluidAdministration.update({ where: { id: itemId }, data: { deletedAt: at } }),
    );
  }

  addMedication(id: string, expectedVersion: number, body: CreateMedication): Promise<CasualtyCard> {
    return this.addChild(id, expectedVersion, () => this.prisma.medication.findUnique({ where: { id: body.id } }), (tx) =>
      tx.medication.create({
        data: {
          ...body,
          cardId: id,
          administeredAt: new Date(body.administeredAt),
        } as Prisma.MedicationUncheckedCreateInput,
      }),
    );
  }

  patchMedication(id: string, itemId: string, expectedVersion: number, body: PatchMedication): Promise<CasualtyCard> {
    return this.patchChild(id, itemId, expectedVersion, (tx) => tx.medication.findUnique({ where: { id: itemId } }), (tx) =>
      tx.medication.update({
        where: { id: itemId },
        data: {
          ...body,
          ...(body.administeredAt !== undefined ? { administeredAt: new Date(body.administeredAt) } : {}),
        } as Prisma.MedicationUncheckedUpdateInput,
      }),
    );
  }

  deleteMedication(id: string, itemId: string, expectedVersion: number): Promise<CasualtyCard> {
    return this.tombstoneChild(id, itemId, expectedVersion, (tx) => tx.medication.findUnique({ where: { id: itemId } }), (tx, at) =>
      tx.medication.update({ where: { id: itemId }, data: { deletedAt: at } }),
    );
  }

  private replay(existing: CardWithChildren, input: CreateCasualty): CasualtyCard {
    if (!sameCard(existing, input)) {
      throw new ConflictException('Casualty id already exists with different data');
    }
    return toCardDto(existing);
  }

  private async addChild(
    cardId: string,
    expectedVersion: number,
    find: () => Promise<{ cardId: string } | null>,
    create: (tx: Tx) => Promise<unknown>,
  ): Promise<CasualtyCard> {
    const existing = await find();
    if (existing) {
      if (existing.cardId !== cardId) throw new ConflictException('Child row id belongs to another casualty');
      throw new ConflictException('Child row id already exists');
    }
    return this.withCard(cardId, expectedVersion, async (tx) => {
      await create(tx);
      return 'bump';
    });
  }

  private patchChild(
    cardId: string,
    itemId: string,
    expectedVersion: number,
    find: (tx: Tx) => Promise<{ cardId: string; deletedAt: Date | null } | null>,
    update: (tx: Tx) => Promise<unknown>,
  ): Promise<CasualtyCard> {
    return this.withCard(cardId, expectedVersion, async (tx) => {
      const row = await find(tx);
      if (!row || row.cardId !== cardId || row.deletedAt) {
        throw new NotFoundException(`Row ${itemId} not found`);
      }
      await update(tx);
      return 'bump';
    });
  }

  private tombstoneChild(
    cardId: string,
    itemId: string,
    expectedVersion: number,
    find: (tx: Tx) => Promise<{ cardId: string; deletedAt: Date | null } | null>,
    update: (tx: Tx, deletedAt: Date) => Promise<unknown>,
  ): Promise<CasualtyCard> {
    return this.withCard(cardId, expectedVersion, async (tx) => {
      const row = await find(tx);
      if (!row || row.cardId !== cardId) throw new NotFoundException(`Row ${itemId} not found`);
      if (row.deletedAt) return 'keep';
      await update(tx, new Date());
      return 'bump';
    });
  }

  private async withCard(
    id: string,
    expectedVersion: number,
    mutate: (tx: Tx, card: CardWithChildren) => Promise<Write>,
    options?: { allowDeleted?: boolean },
  ): Promise<CasualtyCard> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CasualtyCard" WHERE id = ${id}::uuid FOR UPDATE`;
      const card = await tx.casualtyCard.findUnique({ where: { id }, include: cardWithChildren });
      if (!card || (card.deletedAt && !options?.allowDeleted)) {
        throw new NotFoundException(`Casualty ${id} not found`);
      }
      assertVersion(card.version, expectedVersion);
      const write = await mutate(tx, card);
      if (write === 'bump') {
        await tx.casualtyCard.update({
          where: { id },
          data: { version: { increment: 1 }, changeSeq: await nextChangeSeq(tx) },
        });
      }
      const next = await tx.casualtyCard.findUnique({ where: { id }, include: cardWithChildren });
      if (!next) throw new NotFoundException(`Casualty ${id} not found`);
      return next;
    });
    return toCardDto(updated);
  }
}

function fieldsOf(input: CreateCasualty): CardFields {
  const { id: _id, createdByDeviceId: _device, fieldClock: _clock, ...fields } = input;
  return fields;
}

function toCardColumns(fields: Partial<CardFields>): Record<string, unknown> {
  const data: Record<string, unknown> = { ...fields };
  if (fields.injuredAt !== undefined) {
    data.injuredAt = fields.injuredAt ? new Date(fields.injuredAt) : null;
  }
  return data;
}

function sameCard(existing: CardWithChildren, input: CreateCasualty): boolean {
  const dto = toCardDto(existing);
  const fields = fieldsOf(input);
  for (const key of CARD_FIELDS) {
    if (key === 'injuredAt') {
      if (!sameInstant(dto.injuredAt, fields.injuredAt)) return false;
      continue;
    }
    if (JSON.stringify(dto[key]) !== JSON.stringify(fields[key])) return false;
  }
  return (
    existing.createdByDeviceId === input.createdByDeviceId &&
    JSON.stringify(dto.fieldClock) === JSON.stringify(input.fieldClock ?? {})
  );
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left == null || right == null) return left === right;
  return Date.parse(left) === Date.parse(right);
}

function parseLimb(value: string): (typeof Limb)[keyof typeof Limb] {
  const parsed = z.enum(Limb).safeParse(value);
  if (!parsed.success) throw new BadRequestException(`Unknown limb ${value}`);
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
