import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";
import { normalizeForm } from "./values";

const FORM_ROW_ID = "00000000-0000-4000-8000-000000000000";
const FORM_HLC = "0000000000000:0000:form";

/** react-hook-form resolver over a shared section schema, with blank inputs treated as null. */
export function sharedResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  const resolve = zodResolver(schema as never) as Resolver<T>;
  return (values, context, options) => resolve(normalizeForm(values) as T, context, options);
}

/**
 * Validates a child-row form with the shared row schema. Identity and clock fields
 * are filled by the repository on save, so the form does not collect them.
 */
export function childResolver<T extends FieldValues>(schema: ZodType, cardId: string): Resolver<T> {
  return (values) => {
    const parsed = schema.safeParse({
      id: FORM_ROW_ID,
      cardId,
      clientUpdatedAt: FORM_HLC,
      deletedAt: null,
      ...((normalizeForm(values) as object) ?? {}),
    });
    if (parsed.success) {
      const row = parsed.data as Record<string, unknown>;
      delete row.id;
      delete row.cardId;
      delete row.clientUpdatedAt;
      delete row.deletedAt;
      return { values: row as T, errors: {} };
    }

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length === 0 ? "root" : String(issue.path[0]);
      if (!errors[key]) errors[key] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
