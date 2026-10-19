import type { CardPatch } from "@tccc/shared";
import type { ResponderProfile } from "@/lib/db/types";

/** Section H defaults copied onto a new card. Invalid profile values are left blank. */
export function responderPatch(profile: ResponderProfile | undefined): CardPatch {
  if (!profile) return {};
  const patch: CardPatch = {};
  const name = profile.name.trim();
  if (name.length >= 1 && name.length <= 100) patch.responderName = name;
  if (/^\d{4}$/.test(profile.last4)) patch.responderLast4 = profile.last4;
  return patch;
}
