import { cardPatchSchema, type CardPatch } from "@tccc/shared";
import type { ZodType } from "zod";
import type { CasualtyRepo } from "@/lib/db";
import type { ResponderProfile } from "@/lib/db/types";

/** Trim text and turn blank strings into null so section schemas accept empty inputs. */
export function normalizeForm(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeForm(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeForm(item)]));
  }
  return value;
}

/** Section H defaults copied onto a new card. Invalid profile values are left blank. */
export function responderPatch(profile: ResponderProfile | undefined): CardPatch {
  if (!profile) return {};
  const patch: CardPatch = {};
  const name = profile.name.trim();
  if (name.length >= 1 && name.length <= 100) patch.responderName = name;
  if (/^\d{4}$/.test(profile.last4)) patch.responderLast4 = profile.last4;
  return patch;
}

/** Fields from a step that already satisfy the shared card patch schema. */
export function validPatch(schema: ZodType, values: unknown): CardPatch {
  const normalized = normalizeForm(values);
  const full = schema.safeParse(normalized);
  if (full.success) return full.data as CardPatch;

  const invalid = new Set(full.error.issues.map((issue) => String(issue.path[0])));
  const partial: Record<string, unknown> = {};
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    for (const [key, item] of Object.entries(normalized)) {
      if (!invalid.has(key)) partial[key] = item;
    }
  }
  const parsed = cardPatchSchema.safeParse(partial);
  return parsed.success ? parsed.data : {};
}

/**
 * Writes a section through the repository. Valid fields are stored even when another
 * field on the same step is still invalid, so a reload keeps the entered data.
 * Returns true only when the whole section matches its schema.
 */
export async function persistSection(
  repo: CasualtyRepo,
  cardId: string,
  schema: ZodType,
  values: unknown,
): Promise<boolean> {
  const patch = validPatch(schema, values);
  if (Object.keys(patch).length > 0) await repo.updateFields(cardId, patch);
  return schema.safeParse(normalizeForm(values)).success;
}
