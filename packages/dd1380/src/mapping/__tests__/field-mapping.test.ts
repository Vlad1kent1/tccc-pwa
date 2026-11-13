import { describe, expect, it } from "vitest";
import { cardNameLine, splitName } from "../field-mapping";

describe("DD Form 1380 mapping", () => {
  it("round-trips names through the single name line", () => {
    for (const name of [
      { lastName: "Van Damme", firstName: null },
      { lastName: "Doe", firstName: "John" },
      { lastName: "De la Cruz", firstName: "Maria Elena" },
      { lastName: null, firstName: "Olena" },
      { lastName: null, firstName: null },
    ]) {
      expect(splitName(cardNameLine(name))).toEqual(name);
    }
  });
});
