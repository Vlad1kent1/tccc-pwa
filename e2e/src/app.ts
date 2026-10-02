import { expect, type Page } from "@playwright/test";

export interface LocalCard {
  id: string;
  lastName: string | null;
  notes: string | null;
  allergies: string | null;
  evacPriority: string | null;
  syncStatus: string;
  serverVersion: number | null;
  activeVitals: number;
}

export async function boot(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Casualties" })).toBeVisible();
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    if (registration.waiting && !navigator.serviceWorker.controller) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 4000);
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  });
  // A reload puts this document under the active worker, so later offline
  // navigations are served from the precache instead of the network.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Casualties" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker?.controller != null), { timeout: 15_000 })
    .toBe(true);
  // Visit the new-casualty shell while the network is up so the first offline
  // create is served from cache instead of the offline fallback.
  await page.goto("/casualties/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("patient-name-input")).toBeVisible();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Casualties" })).toBeVisible();
}

export async function createCasualty(page: Page, lastName: string): Promise<string> {
  // A full unload drops the wizard's in-memory "create in progress" card so the
  // next name cannot overwrite the one just saved.
  await page.goto("about:blank").catch(() => undefined);
  try {
    await page.goto("/casualties/new", { waitUntil: "domcontentloaded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("interrupted")) throw error;
  }
  const lastNameField = page.getByTestId("patient-name-input");
  await expect(lastNameField).toBeVisible({ timeout: 30_000 });
  await expect(lastNameField).toBeEnabled({ timeout: 15_000 });
  await lastNameField.fill(lastName);
  await lastNameField.blur();
  // history.replaceState updates the query without a document navigation.
  // waitForURL waits for "load" and rejects with ERR_ABORTED when that
  // navigation is cancelled offline.
  await expect
    .poll(() => {
      try {
        return new URL(page.url()).searchParams.get("id") ?? "";
      } catch {
        return "";
      }
    }, { timeout: 15_000 })
    .not.toBe("");
  const id = new URL(page.url()).searchParams.get("id");
  if (!id) throw new Error(`Card for ${lastName} was not created`);
  await expect.poll(async () => (await readLocalCards(page)).some((card) => card.id === id && card.lastName === lastName)).toBe(true);
  await nudge(page);
  return id;
}

function sameTarget(page: Page, url: string): boolean {
  try {
    const current = new URL(page.url());
    const target = new URL(url, current.origin);
    if (current.pathname !== target.pathname) return false;
    return ["id", "section", "step"].every((key) => current.searchParams.get(key) === target.searchParams.get(key));
  } catch {
    return false;
  }
}

async function visit(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (sameTarget(page, url)) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return;
    }
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes("interrupted") || message.includes("ERR_ABORTED") || message.includes("detached");
      if (attempt === 5 || !retryable) throw error;
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(200);
    }
  }
}

/**
 * Waits until a pull has stored the card, then searches so the virtualized
 * list renders that row. A name below the fold is not in the DOM.
 */
export async function waitForListed(page: Page, name: string): Promise<void> {
  await visit(page, "/");
  await nudge(page);
  await expect
    .poll(async () => (await readLocalCards(page)).some((card) => card.lastName === name), { timeout: 30_000 })
    .toBe(true);
  await page.getByRole("searchbox", { name: "Search casualties" }).fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

const EDIT_FIELDS = {
  "Last name": "lastName",
  Notes: "notes",
  Allergies: "allergies",
} as const satisfies Record<string, keyof LocalCard>;

export async function editField(page: Page, id: string, section: string, label: string, value: string): Promise<void> {
  await visit(page, `/casualties/card/edit?id=${encodeURIComponent(id)}&section=${section}`);
  const field = label === "Last name" ? page.getByTestId("patient-name-input") : page.getByRole("textbox", { name: label, exact: true });
  await expect(field).toBeVisible();
  await field.fill(value);
  // Section forms save on a 400ms debounce, not on each keystroke.
  await field.blur();
  await page.keyboard.press("Tab");
  // A fixed Playwright clock does not run timers until time is advanced.
  // One second is enough for the debounce and keeps an hour-ahead clock ahead.
  await page.clock.fastForward(1_000).catch(() => undefined);
  const stored = EDIT_FIELDS[label as keyof typeof EDIT_FIELDS];
  await expect
    .poll(async () => {
      const cards = await readLocalCards(page);
      return cards.some((card) => card.id === id && card[stored] === value);
    }, { timeout: 15_000 })
    .toBe(true);
  await nudge(page);
}

const PRIORITY_VALUE = {
  Urgent: "URGENT",
  Priority: "PRIORITY",
  Routine: "ROUTINE",
} as const;

export async function choosePriority(page: Page, id: string, label: "Urgent" | "Priority" | "Routine"): Promise<void> {
  await visit(page, `/casualties/card?id=${encodeURIComponent(id)}`);
  const radio = page.getByRole("radio", { name: label, exact: true }).first();
  await expect(radio).toBeVisible();
  await radio.check();
  await page.keyboard.press("Tab");
  await page.clock.fastForward(1_000).catch(() => undefined);
  await expect
    .poll(async () => (await readLocalCards(page)).some((card) => card.id === id && card.evacPriority === PRIORITY_VALUE[label]), {
      timeout: 15_000,
    })
    .toBe(true);
  await nudge(page);
}

async function evaluateWithRetry<T>(page: Page, read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !message.includes("Execution context was destroyed")) throw error;
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
  }
  throw new Error("Page evaluate did not complete");
}

export async function readLocalCards(page: Page): Promise<LocalCard[]> {
  return evaluateWithRetry(page, () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tccc");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = db.transaction("casualties").objectStore("casualties").getAll();
        request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
        request.onerror = () => reject(request.error);
      });
      return rows
        .filter((row) => row.deletedAt == null)
        .map((row) => ({
          id: String(row.id),
          lastName: (row.lastName as string | null) ?? null,
          notes: (row.notes as string | null) ?? null,
          allergies: (row.allergies as string | null) ?? null,
          evacPriority: (row.evacPriority as string | null) ?? null,
          syncStatus: String(row.syncStatus),
          serverVersion: (row.serverVersion as number | null) ?? null,
          activeVitals: Array.isArray(row.vitalSigns)
            ? row.vitalSigns.filter((vital) => (vital as { deletedAt?: string | null }).deletedAt == null).length
            : 0,
        }));
    } finally {
      db.close();
    }
  }));
}

export async function outboxCount(page: Page): Promise<number> {
  return evaluateWithRetry(page, () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tccc");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction("outbox").objectStore("outbox").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }));
}

export async function outboxAttempts(page: Page): Promise<number> {
  return evaluateWithRetry(page, () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tccc");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<{ attempts?: number }>>((resolve, reject) => {
        const request = db.transaction("outbox").objectStore("outbox").getAll();
        request.onsuccess = () => resolve(request.result as Array<{ attempts?: number }>);
        request.onerror = () => reject(request.error);
      });
      return rows.reduce((max, row) => Math.max(max, row.attempts ?? 0), 0);
    } finally {
      db.close();
    }
  }));
}

/** Asks the sync engine to run. Headless Chromium can defer the 2s write timer. */
export async function nudge(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("online"))).catch(() => undefined);
}

export async function reconnect(page: Page): Promise<void> {
  await page.context().setOffline(false);
  // Leaving offline can reload the document. The reloaded page syncs on startup;
  // nudge covers the case where the same document stays up.
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(300);
  await nudge(page);
}

export async function manualSync(page: Page): Promise<void> {
  await page.goto("/casualties/card?id=00000000-0000-4000-8000-000000000099");
  await page.getByRole("button", { name: "Sync now" }).click();
}
