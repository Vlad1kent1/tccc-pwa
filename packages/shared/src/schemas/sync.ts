import { z } from "zod";
import {
  CARD_FIELDS,
  CHILD_ENTITIES,
  cardPatchSchema,
  casualtyCardSchema,
  fluidSchema,
  hlcSchema,
  injurySiteSchema,
  isoDateTimeSchema,
  medicationSchema,
  tourniquetSchema,
  uuidSchema,
  vitalSignsSchema,
} from "./card.js";

// Protocol described in PLAN.md, sections 4.3 and 4.4.

const mutationBaseShape = {
  mutationId: uuidSchema,
  cardId: uuidSchema,
  hlc: hlcSchema,
  /** Card version the client last saw from the server; null for cards never acknowledged. */
  baseVersion: z.number().int().min(1).nullable(),
};

export const cardUpsertMutationSchema = z
  .object({
    ...mutationBaseShape,
    op: z.literal("card.upsert"),
    patch: cardPatchSchema,
    changedFields: z.array(z.enum(CARD_FIELDS)),
  })
  .refine(
    (m) => {
      const keys = Object.keys(m.patch);
      return keys.length === m.changedFields.length && keys.every((k) => m.changedFields.includes(k as never));
    },
    { message: "changedFields must list exactly the keys of patch", path: ["changedFields"] },
  );

export const cardDeleteMutationSchema = z.object({
  ...mutationBaseShape,
  op: z.literal("card.delete"),
  deletedAt: isoDateTimeSchema,
});

const childUpsert = <E extends string, S extends z.ZodType>(entity: E, row: S) =>
  z.object({
    ...mutationBaseShape,
    op: z.literal("child.upsert"),
    entity: z.literal(entity),
    row,
  });

export const childUpsertMutationSchema = z.discriminatedUnion("entity", [
  childUpsert("injurySite", injurySiteSchema),
  childUpsert("tourniquet", tourniquetSchema),
  childUpsert("vitalSigns", vitalSignsSchema),
  childUpsert("fluid", fluidSchema),
  childUpsert("medication", medicationSchema),
]);

export const childDeleteMutationSchema = z.object({
  ...mutationBaseShape,
  op: z.literal("child.delete"),
  entity: z.enum(CHILD_ENTITIES),
  entityId: uuidSchema,
  deletedAt: isoDateTimeSchema,
});

export const mutationSchema = z
  .union([cardUpsertMutationSchema, cardDeleteMutationSchema, childUpsertMutationSchema, childDeleteMutationSchema])
  .refine((m) => m.op !== "child.upsert" || m.row.cardId === m.cardId, {
    message: "row.cardId must match cardId",
    path: ["row", "cardId"],
  });
export type Mutation = z.infer<typeof mutationSchema>;
export type MutationOp = Mutation["op"];

// Mutations are validated individually on the server, so one invalid mutation is
// rejected without failing the rest of the batch.
export const pushRequestSchema = z.object({
  deviceId: uuidSchema,
  mutations: z.array(z.looseObject({ mutationId: uuidSchema })).min(1).max(500),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const syncConflictSchema = z.object({
  entity: z.enum(["card", ...CHILD_ENTITIES]),
  entityId: uuidSchema,
  field: z.string(),
  kept: z.unknown(),
  discarded: z.unknown(),
});
export type SyncConflictInfo = z.infer<typeof syncConflictSchema>;

export const MUTATION_ERROR_CODES = ["VALIDATION", "NOT_FOUND", "INTERNAL"] as const;

export const mutationResultSchema = z.discriminatedUnion("status", [
  z.object({ mutationId: uuidSchema, status: z.literal("applied"), card: casualtyCardSchema }),
  z.object({
    mutationId: uuidSchema,
    status: z.literal("merged"),
    card: casualtyCardSchema,
    conflicts: z.array(syncConflictSchema),
  }),
  z.object({
    mutationId: uuidSchema,
    status: z.literal("rejected"),
    error: z.object({
      code: z.enum(MUTATION_ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
]);
export type MutationResult = z.infer<typeof mutationResultSchema>;

export const pushResponseSchema = z.object({
  results: z.array(mutationResultSchema),
  serverTime: isoDateTimeSchema,
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

export const pullQuerySchema = z.object({
  since: z.string().regex(/^\d+$/).default("0"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

export const pullResponseSchema = z.object({
  cards: z.array(casualtyCardSchema),
  nextSince: z.string().regex(/^\d+$/),
  hasMore: z.boolean(),
  serverTime: isoDateTimeSchema,
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
