import type { CardPatch } from "@tccc/shared";
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
