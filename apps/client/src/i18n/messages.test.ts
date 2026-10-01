import { ENUMS } from "@tccc/shared";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { uk } from "./uk";

describe("i18n dictionaries", () => {
  it("translates every shared enum value in English and Ukrainian", () => {
    for (const [group, values] of Object.entries(ENUMS)) {
      for (const value of Object.values(values)) {
        const enLabel = (en.enums as Record<string, Record<string, string>>)[group]?.[value];
        const ukLabel = (uk.enums as Record<string, Record<string, string>>)[group]?.[value];
        expect(enLabel, `en ${group}.${value}`).toBeTruthy();
        expect(ukLabel, `uk ${group}.${value}`).toBeTruthy();
        expect(ukLabel).not.toBe(enLabel);
      }
    }
  });
});
