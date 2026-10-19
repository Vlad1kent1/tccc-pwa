import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMeta } from "@/lib/db/meta";
import { db } from "@/lib/db/schema";
import { parseUnitToken, readUnitToken, saveUnitToken, UNIT_TOKEN_STORAGE_KEY } from "./unit-token";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(async () => {
  await saveUnitToken(null);
  vi.unstubAllGlobals();
});

describe("parseUnitToken", () => {
  it("trims, treats blank as no token, and refuses values a header cannot carry", () => {
    expect(parseUnitToken("  abc-DEF_123  ")).toEqual({ ok: true, token: "abc-DEF_123" });
    expect(parseUnitToken("   ")).toEqual({ ok: true, token: null });
    expect(parseUnitToken("two words")).toEqual({ ok: false });
    expect(parseUnitToken("токен")).toEqual({ ok: false });
    expect(parseUnitToken("x".repeat(513))).toEqual({ ok: false });
  });
});

describe("unit token storage", () => {
  it("keeps the token in localStorage and mirrors it for the service worker", async () => {
    await saveUnitToken("unit-secret-0001");
    expect(storage.getItem(UNIT_TOKEN_STORAGE_KEY)).toBe("unit-secret-0001");
    expect(await getMeta(db, "unitToken")).toBe("unit-secret-0001");
    expect(await readUnitToken()).toBe("unit-secret-0001");
  });

  it("reads the IndexedDB copy where localStorage does not exist", async () => {
    await saveUnitToken("unit-secret-0002");
    vi.stubGlobal("localStorage", undefined);
    expect(await readUnitToken()).toBe("unit-secret-0002");
  });

  it("copies a token placed straight into localStorage to the worker's mirror", async () => {
    storage.setItem(UNIT_TOKEN_STORAGE_KEY, "seeded-token-0003");
    expect(await readUnitToken()).toBe("seeded-token-0003");
    await vi.waitFor(async () => expect(await getMeta(db, "unitToken")).toBe("seeded-token-0003"));
  });

  it("removes the token from both stores", async () => {
    await saveUnitToken("unit-secret-0004");
    await saveUnitToken(null);
    expect(storage.getItem(UNIT_TOKEN_STORAGE_KEY)).toBeNull();
    expect(await getMeta(db, "unitToken")).toBeUndefined();
    expect(await readUnitToken()).toBeNull();
  });
});
