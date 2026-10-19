import { getMeta, setMeta } from "../db/meta";
import { db } from "../db/schema";

/**
 * The shared secret the API expects as `Authorization: Bearer <token>`.
 * Windows keep it in localStorage. A copy lives in the IndexedDB `meta` table because
 * the service worker pushes the outbox with no window open and has no localStorage.
 */
export const UNIT_TOKEN_STORAGE_KEY = "tccc.unitToken";
const STORAGE_KEY = UNIT_TOKEN_STORAGE_KEY;
const MAX_LENGTH = 512;

/** Header values must be visible ASCII; anything else makes fetch throw before sending. */
export function parseUnitToken(raw: string): { ok: true; token: string | null } | { ok: false } {
  const token = raw.trim();
  if (!token) return { ok: true, token: null };
  if (token.length > MAX_LENGTH || !/^[\x21-\x7E]+$/.test(token)) return { ok: false };
  return { ok: true, token };
}

/** `undefined` when localStorage is missing (worker) or blocked. */
function readLocal(): string | null | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
}

function writeLocal(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the IndexedDB copy still holds the token.
  }
}

async function readMirror(): Promise<string | null> {
  try {
    return (await getMeta(db, "unitToken")) ?? null;
  } catch {
    return null;
  }
}

async function writeMirror(token: string | null): Promise<void> {
  if (token) await setMeta(db, "unitToken", token);
  else await db.meta.delete("unitToken");
}

let mirrored: string | null | undefined;

/**
 * The current token, or null when none is set. A window also refreshes the worker's
 * copy when it differs, e.g. after the token was put into localStorage directly.
 */
export async function readUnitToken(): Promise<string | null> {
  const local = readLocal();
  if (local === undefined) return readMirror();
  if (local) {
    if (mirrored !== local) {
      mirrored = local;
      void writeMirror(local).catch(() => {
        mirrored = undefined;
      });
    }
    return local;
  }
  const copy = await readMirror();
  if (copy) writeLocal(copy);
  return copy;
}

export async function saveUnitToken(token: string | null): Promise<void> {
  writeLocal(token);
  await writeMirror(token);
  mirrored = token;
}
