import type { CasualtyCard as CardDto } from '@tccc/shared';
import type { Prisma } from '../generated/prisma/client.js';

export const cardWithChildren = {
  injurySites: true,
  tourniquets: true,
  vitalSigns: { orderBy: { measuredAt: 'asc' } },
  fluids: true,
  medications: true,
} satisfies Prisma.CasualtyCardInclude;

export type CardWithChildren = Prisma.CasualtyCardGetPayload<{
  include: typeof cardWithChildren;
}>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** Converts a Prisma aggregate to the wire format described by `casualtyCardSchema`. */
export function toCardDto(card: CardWithChildren): CardDto {
  const {
    injurySites,
    tourniquets,
    vitalSigns,
    fluids,
    medications,
    injuredAt,
    fieldClock,
    changeSeq,
    createdAt,
    serverUpdatedAt,
    deletedAt,
    ...scalars
  } = card;

  return {
    ...scalars,
    injuredAt: isoOrNull(injuredAt),
    injurySites: injurySites.map((r) => ({ ...r, deletedAt: isoOrNull(r.deletedAt) })),
    tourniquets: tourniquets.map((r) => ({
      ...r,
      appliedAt: iso(r.appliedAt),
      deletedAt: isoOrNull(r.deletedAt),
    })),
    vitalSigns: vitalSigns.map((r) => ({
      ...r,
      measuredAt: iso(r.measuredAt),
      deletedAt: isoOrNull(r.deletedAt),
    })),
    fluids: fluids.map((r) => ({
      ...r,
      administeredAt: iso(r.administeredAt),
      deletedAt: isoOrNull(r.deletedAt),
    })),
    medications: medications.map((r) => ({
      ...r,
      administeredAt: iso(r.administeredAt),
      deletedAt: isoOrNull(r.deletedAt),
    })),
    fieldClock: fieldClock as Record<string, string>,
    changeSeq: changeSeq.toString(),
    createdAt: iso(createdAt),
    serverUpdatedAt: iso(serverUpdatedAt),
    deletedAt: isoOrNull(deletedAt),
  };
}
