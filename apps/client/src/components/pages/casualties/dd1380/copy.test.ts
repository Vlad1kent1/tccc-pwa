import { describe, expect, it } from "vitest";
import { translations } from "@/components/pages/casualties/dd1380/copy";

function leaves(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? leaves(child, path) : [path];
  });
}

describe("DD1380 card copy", () => {
  it("has the same labels in English and Ukrainian", () => {
    expect(leaves(translations.en).sort()).toEqual(leaves(translations.uk).sort());
  });

  it("keeps the paper headings in each language", () => {
    expect(translations.en.title).toContain("TACTICAL COMBAT CASUALTY CARE");
    expect(translations.uk.title).toBe("КАРТКА ПОРАНЕНОГО ТССС");
    expect(translations.en.meds).toBe("MEDS:");
    expect(translations.uk.meds).toBe("Медикаменти:");
    expect(translations.en.fluid).toBe("Fluid");
    expect(translations.uk.fluid).toBe("Рідина");
    expect(translations.uk.urgent).not.toBe(translations.en.urgent);
  });
});