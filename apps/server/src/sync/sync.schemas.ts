import { pullQuerySchema, pushRequestSchema, uuidSchema } from '@tccc/shared';
import { z } from 'zod';

export class PushRequestDto {
  static schema = pushRequestSchema;
}

export class PullQueryDto {
  static schema = pullQuerySchema;
}

export const listConflictsQuerySchema = z
  .object({
    cardId: uuidSchema.optional(),
    resolved: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ListConflictsQuery = z.infer<typeof listConflictsQuerySchema>;

export class ListConflictsQueryDto {
  static schema = listConflictsQuerySchema;
}

export const resolveConflictSchema = z
  .object({
    choice: z.enum(['kept', 'discarded']),
  })
  .strict();
export type ResolveConflict = z.infer<typeof resolveConflictSchema>;

export class ResolveConflictDto {
  static schema = resolveConflictSchema;
}
