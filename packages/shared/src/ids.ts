import { v5 as uuidv5, v7 as uuidv7 } from "uuid";
import type { Limb } from "./enums.js";

export const TOURNIQUET_ID_NAMESPACE = "7d6a0f3e-4c2b-4f1a-9e8d-2b5c6a7f8e91";

/** Time-ordered UUIDv7, generated on the device so records can be created offline. */
export function newId(): string {
  return uuidv7();
}

/**
 * Deterministic tourniquet id: two devices recording a tourniquet on the same limb
 * of the same card offline produce the same id, so the records merge on sync.
 */
export function tourniquetId(cardId: string, limb: Limb): string {
  return uuidv5(`${cardId}:${limb}`, TOURNIQUET_ID_NAMESPACE);
}
