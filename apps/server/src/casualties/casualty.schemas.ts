import {
  cardFieldsSchema,
  cardPatchSchema,
  fluidSchema,
  injurySiteSchema,
  isoDateTimeSchema,
  medicationSchema,
  tourniquetSchema,
  uuidSchema,
  vitalSignsSchema,
  EvacPriority,
} from '@tccc/shared';
import { z } from 'zod';

export const createCasualtySchema = cardFieldsSchema
  .extend({
    id: uuidSchema,
    createdByDeviceId: uuidSchema,
    fieldClock: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type CreateCasualty = z.infer<typeof createCasualtySchema>;

export class CreateCasualtyDto {
  static schema = createCasualtySchema;
}

export class CardPatchDto {
  static schema = cardPatchSchema;
}

export const listCasualtiesQuerySchema = z.object({
  priority: z.enum(EvacPriority).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  updatedSince: isoDateTimeSchema.optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListCasualtiesQuery = z.infer<typeof listCasualtiesQuerySchema>;

export class ListCasualtiesQueryDto {
  static schema = listCasualtiesQuerySchema;
}

export const createInjurySiteSchema = injurySiteSchema.omit({ cardId: true, deletedAt: true }).strict();
export type CreateInjurySite = z.infer<typeof createInjurySiteSchema>;
export class CreateInjurySiteDto {
  static schema = createInjurySiteSchema;
}

export const patchInjurySiteSchema = injurySiteSchema
  .omit({ id: true, cardId: true, deletedAt: true })
  .partial()
  .required({ clientUpdatedAt: true })
  .strict();
export type PatchInjurySite = z.infer<typeof patchInjurySiteSchema>;
export class PatchInjurySiteDto {
  static schema = patchInjurySiteSchema;
}

export const upsertTourniquetSchema = tourniquetSchema
  .pick({ type: true, appliedAt: true, clientUpdatedAt: true })
  .strict();
export type UpsertTourniquet = z.infer<typeof upsertTourniquetSchema>;
export class UpsertTourniquetDto {
  static schema = upsertTourniquetSchema;
}

const { id: vitalId, cardId: _vitalCardId, deletedAt: _vitalDeletedAt, ...vitalMeasurementShape } = vitalSignsSchema.shape;

const VITAL_MEASUREMENTS = [
  "pulseRate",
  "pulseLocation",
  "systolic",
  "diastolic",
  "respiratoryRate",
  "spo2",
  "avpu",
  "painScale",
] as const;

function withVitalRules<T extends z.ZodType>(schema: T) {
  return schema
    .refine(
      (value) => {
        const row = value as Record<string, unknown>;
        return VITAL_MEASUREMENTS.some((key) => row[key] != null);
      },
      { message: "At least one measurement is required" },
    )
    .refine(
      (value) => {
        const row = value as { systolic?: number | null; diastolic?: number | null };
        return row.systolic == null || row.diastolic == null || row.systolic >= row.diastolic;
      },
      { message: "Systolic pressure must not be lower than diastolic", path: ["systolic"] },
    );
}

export const createVitalSignsSchema = withVitalRules(z.object({ id: vitalId, ...vitalMeasurementShape }).strict());
export type CreateVitalSigns = z.infer<typeof createVitalSignsSchema>;
export class CreateVitalSignsDto {
  static schema = createVitalSignsSchema;
}

export const patchVitalSignsSchema = withVitalRules(
  z.object(vitalMeasurementShape).partial().required({ clientUpdatedAt: true }).strict(),
);
export type PatchVitalSigns = z.infer<typeof patchVitalSignsSchema>;
export class PatchVitalSignsDto {
  static schema = patchVitalSignsSchema;
}

export const createFluidSchema = fluidSchema.omit({ cardId: true, deletedAt: true }).strict();
export type CreateFluid = z.infer<typeof createFluidSchema>;
export class CreateFluidDto {
  static schema = createFluidSchema;
}

export const patchFluidSchema = fluidSchema
  .omit({ id: true, cardId: true, deletedAt: true })
  .partial()
  .required({ clientUpdatedAt: true })
  .strict();
export type PatchFluid = z.infer<typeof patchFluidSchema>;
export class PatchFluidDto {
  static schema = patchFluidSchema;
}

export const createMedicationSchema = medicationSchema.omit({ cardId: true, deletedAt: true }).strict();
export type CreateMedication = z.infer<typeof createMedicationSchema>;
export class CreateMedicationDto {
  static schema = createMedicationSchema;
}

export const patchMedicationSchema = medicationSchema
  .omit({ id: true, cardId: true, deletedAt: true })
  .partial()
  .required({ clientUpdatedAt: true })
  .strict();
export type PatchMedication = z.infer<typeof patchMedicationSchema>;
export class PatchMedicationDto {
  static schema = patchMedicationSchema;
}
