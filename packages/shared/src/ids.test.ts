import { describe, expect, it } from "vitest";
import { version as uuidVersion } from "uuid";
import { newId, tourniquetId } from "./ids.js";
import { Limb } from "./enums.js";

describe("ids", () => {
  it("generates time-ordered UUIDv7 ids", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(ids.every((id) => uuidVersion(id) === 7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });

  it("derives the same tourniquet id for the same card and limb", () => {
    const cardId = newId();
    expect(tourniquetId(cardId, Limb.LEFT_LEG)).toBe(tourniquetId(cardId, Limb.LEFT_LEG));
    expect(uuidVersion(tourniquetId(cardId, Limb.LEFT_LEG))).toBe(5);
  });

  it("derives different tourniquet ids for different limbs or cards", () => {
    const cardId = newId();
    const ids = new Set(Object.values(Limb).map((limb) => tourniquetId(cardId, limb)));
    expect(ids.size).toBe(4);
    expect(tourniquetId(newId(), Limb.LEFT_LEG)).not.toBe(tourniquetId(cardId, Limb.LEFT_LEG));
  });
});
