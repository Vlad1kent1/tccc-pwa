import { CHILD_ENTITIES } from "./schemas/card.js";

/**
 * Which collisions a medic must decide, and which may merge quietly.
 *
 * Silent last-writer-wins (card scalars only): identity, injury mechanism,
 * treatment checkboxes, notes, and responder details. A newer clock replaces
 * the stored value and the loser stays in the server audit log, but the card
 * does not block.
 *
 * Must block the card until someone chooses Keep or Use other:
 * - triage and safety: `evacPriority`, `allergies`, and `deletedAt`
 * - every clinical child row (injury site, tourniquet, vitals, fluid, medication),
 *   whether the collision is the whole row or its tombstone
 */
export const REVIEW_CARD_FIELDS = ["evacPriority", "allergies", "deletedAt"] as const;

const REVIEW_CARD_FIELD_SET = new Set<string>(REVIEW_CARD_FIELDS);
const CHILD_ENTITY_SET = new Set<string>(CHILD_ENTITIES);

export function conflictNeedsReview(conflict: { entity: string; field: string }): boolean {
  if (conflict.entity === "card") return REVIEW_CARD_FIELD_SET.has(conflict.field);
  return CHILD_ENTITY_SET.has(conflict.entity);
}
