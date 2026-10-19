import { cardFieldsSchema, type CardField, type CardPatch } from "@tccc/shared";

/** Top-level text only: nested values such as `rowDrafts` keep their raw cell text. */
function normalizeText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export interface CleanPatch {
  /** Fields that passed their schema, normalized as they will be stored. */
  patch: CardPatch;
  /** Fields left out because their value is invalid. */
  invalid: CardField[];
}

const FIELD_SCHEMAS = cardFieldsSchema.shape;

function isCardField(key: string): key is CardField {
  return Object.hasOwn(FIELD_SCHEMAS, key);
}

/**
 * Trims text (blank becomes null) and validates each field on its own. One bad
 * value is left out of the save instead of rolling back every other field with it.
 * Unknown keys and `undefined` values are skipped.
 */
export function cleanCardPatch(raw: Record<string, unknown>): CleanPatch {
  const patch: Record<string, unknown> = {};
  const invalid: CardField[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || !isCardField(key)) continue;
    const parsed = FIELD_SCHEMAS[key].safeParse(normalizeText(value));
    if (parsed.success) patch[key] = parsed.data;
    else invalid.push(key);
  }
  return { patch: patch as CardPatch, invalid };
}
