import { newId } from "@tccc/shared";
import type { Page } from "@playwright/test";
import { API_ORIGIN, expect, test, type ServerCounts } from "../src/fixtures";
import { attachMetrics } from "../src/metrics";
import {
  boot,
  choosePriority,
  createCasualty,
  editField,
  manualSync,
  outboxAttempts,
  outboxCount,
  readLocalCards,
  reconnect,
  waitForListed,
} from "../src/app";

function tag(id: string): string {
  return `E2E-${id}-${Date.now().toString(36)}`;
}

async function cardNamed(counts: ServerCounts, lastName: string) {
  return counts.cards.find((card) => card.lastName === lastName);
}

test.afterEach(async ({ setChaos }) => {
  await setChaos({ latencyMs: 0, failureRate: 0, dropRate: 0 });
});

// WebKit in this Playwright build aborts a navigation started while the context
// is offline ("WebKit encountered an internal error"). Those scenarios run on
// Chromium. WebKit still executes the online sync and validation cases below.
test.beforeEach(({ browserName }) => {
  test.skip(
    test.info().title.startsWith("T-04") || test.info().title.startsWith("T-15")
      ? false
      : browserName !== "chromium",
    "WebKit aborts offline navigations with an internal error. Repeat this scenario in Chromium. Online cases T-04 and T-15 still run on WebKit.",
  );
});

async function storageUsage(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? null;
  });
}

test("T-01 offline create survives reload and syncs once", async ({ page, setOffline: offline, serverCounts }) => {
  const prefix = tag("T01");
  const names = [0, 1, 2, 3, 4].map((index) => `${prefix}-${index}`);
  await boot(page);
  const usageBefore = await storageUsage(page);
  await offline(true);
  for (const name of names) await createCasualty(page, name);
  const view = await page.context().newPage();
  await view.goto("/", { waitUntil: "domcontentloaded" });
  await view.reload({ waitUntil: "domcontentloaded" });
  await expect(view.getByRole("heading", { name: "Casualties" })).toBeVisible();
  await expect(view.getByRole("searchbox", { name: "Search casualties" })).toBeVisible();
  await expect
    .poll(async () => {
      const cards = await readLocalCards(view);
      return names.filter((name) => cards.some((card) => card.lastName === name)).length;
    }, { timeout: 20_000 })
    .toBe(names.length);
  const search = view.getByRole("searchbox", { name: "Search casualties" });
  for (const name of names) {
    await search.fill(name);
    await expect(view.getByText(name, { exact: true })).toBeVisible();
  }
  await reconnect(view);
  await expect.poll(async () => (await serverCounts(prefix)).cards.length, { timeout: 30_000 }).toBe(5);
  const found = await serverCounts(prefix);
  expect(new Set(found.cards.map((card) => card.id)).size).toBe(5);
  const usageAfter = await storageUsage(view);
  const delta = usageBefore != null && usageAfter != null ? usageAfter - usageBefore : null;
  await attachMetrics({
    dataLossCount: 5 - found.cards.length,
    duplicateCount: found.cards.length - new Set(found.cards.map((card) => card.id)).size,
    ...(delta != null && delta > 0 ? { indexedDbBytesPerCard: Math.round(delta / names.length) } : {}),
  });
});

test("T-02 ten offline edits coalesce to the final value", async ({ page, setOffline: offline, serverCounts }) => {
  const name = tag("T02");
  await boot(page);
  const id = await createCasualty(page, name);
  await expect.poll(async () => (await cardNamed(await serverCounts(name), name)) != null, { timeout: 20_000 }).toBe(true);
  await offline(true);
  for (let step = 0; step < 10; step += 1) {
    await editField(page, id, "G", "Notes", `step-${step}`);
  }
  expect(await outboxCount(page)).toBeGreaterThanOrEqual(10);
  const batchSizes: number[] = [];
  const payloadBytes: number[] = [];
  await page.route("**/api/sync/push", async (route) => {
    const raw = route.request().postData() ?? "";
    const body = route.request().postDataJSON() as { mutations?: unknown[] };
    batchSizes.push(body.mutations?.length ?? 0);
    payloadBytes.push(raw.length);
    await route.continue();
  });
  await reconnect(page);
  await expect.poll(async () => (await cardNamed(await serverCounts(name), name))?.notes, { timeout: 20_000 }).toBe("step-9");
  expect(batchSizes.length).toBeGreaterThan(0);
  expect(Math.max(...batchSizes)).toBe(1);
  await attachMetrics({ payloadBytes: Math.max(...payloadBytes) });
});

test("T-03 a dropped in-flight push is retried once", async ({ page, setOffline: offline, serverCounts }) => {
  test.setTimeout(180_000);
  const name = tag("T03");
  await boot(page);
  await offline(true);
  await createCasualty(page, name);
  await page.route("**/api/sync/push", async (route) => {
    try {
      await route.fetch({ timeout: 5_000 });
    } catch {
      // The server may already have applied the body.
    }
    await route.abort("connectionfailed").catch(() => undefined);
  });
  await reconnect(page);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
  await page.unroute("**/api/sync/push").catch(() => undefined);
  const context = page.context();
  const reopened = await context.newPage();
  await page.close();
  await boot(reopened);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
});

test("T-04 dropped responses still apply each mutation once", async ({ playwright, setChaos, serverCounts }) => {
  test.setTimeout(180_000);
  const prefix = tag("T04");
  const deviceId = newId();
  await setChaos({ dropRate: 0.5 });
  const api = await playwright.request.newContext({ baseURL: API_ORIGIN });
  try {
    for (let index = 0; index < 100; index += 1) {
      const cardId = newId();
      const body = {
        deviceId,
        mutations: [
          {
            mutationId: newId(),
            cardId,
            op: "card.upsert",
            baseVersion: null,
            patch: { lastName: `${prefix}-${index}`, evacPriority: "ROUTINE" },
            changedFields: ["lastName", "evacPriority"],
            hlc: `${String(1_790_000_000_000 + index).padStart(13, "0")}:0001:${deviceId}`,
          },
        ],
      };
      let delivered = false;
      for (let attempt = 0; attempt < 40 && !delivered; attempt += 1) {
        try {
          const response = await api.post("/api/sync/push", { data: body, timeout: 10_000 });
          delivered = response.ok();
        } catch {
          delivered = false;
        }
      }
      expect(delivered, `mutation ${index} was never acknowledged`).toBe(true);
    }
  } finally {
    await api.dispose();
  }
  await setChaos({ dropRate: 0 });
  const found = await serverCounts(prefix);
  expect(found.cards).toHaveLength(100);
  expect(new Set(found.cards.map((card) => card.id)).size).toBe(100);
  await attachMetrics({
    dataLossCount: 100 - found.cards.length,
    duplicateCount: found.cards.length - new Set(found.cards.map((card) => card.id)).size,
  });
});

test("T-05 failures are retried and the card still syncs", async ({ page, setOffline: offline, serverCounts, setChaos }) => {
  const name = tag("T05");
  await boot(page);
  await offline(true);
  await createCasualty(page, name);
  await setChaos({ failureRate: 1 });
  await reconnect(page);
  let retries = 0;
  await expect.poll(async () => {
    retries = await outboxAttempts(page);
    return retries;
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await setChaos({ failureRate: 0 });
  await manualSync(page);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
  await attachMetrics({ retryCount: retries, dataLossCount: 0, duplicateCount: 0 });
});

test("T-06 two devices keep edits to different fields", async ({ twoDevices, serverCounts }) => {
  test.setTimeout(180_000);
  const { a, b } = await twoDevices();
  const name = tag("T06");
  await boot(a);
  await boot(b);
  const id = await createCasualty(a, name);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
  await waitForListed(b, name);
  await a.goto(`/casualties/card/edit?id=${encodeURIComponent(id)}&section=A`);
  await expect(a.getByRole("textbox", { name: "Allergies" })).toBeVisible();
  await b.goto(`/casualties/card/edit?id=${encodeURIComponent(id)}&section=G`);
  await expect(b.getByRole("textbox", { name: "Notes" })).toBeVisible();
  await a.context().setOffline(true);
  await b.context().setOffline(true);
  await editField(a, id, "A", "Allergies", "NKDA");
  await editField(b, id, "G", "Notes", "from-b");
  await reconnect(a);
  await reconnect(b);
  await expect
    .poll(async () => cardNamed(await serverCounts(name), name), { timeout: 30_000 })
    .toMatchObject({ allergies: "NKDA", notes: "from-b" });
  const counts = await serverCounts(name);
  const card = counts.cards[0];
  expect(card).toBeTruthy();
  const competing = counts.conflicts.filter(
    (conflict) => conflict.cardId === card!.id && conflict.discardedValue != null,
  );
  expect(competing).toHaveLength(0);
});

test("T-07 the later evac priority wins and a conflict is stored", async ({ twoDevices, serverCounts }) => {
  test.setTimeout(180_000);
  const { a, b } = await twoDevices();
  const name = tag("T07");
  await boot(a);
  await boot(b);
  const id = await createCasualty(a, name);
  await choosePriority(a, id, "Routine");
  await expect.poll(async () => (await cardNamed(await serverCounts(name), name))?.evacPriority, { timeout: 20_000 }).toBe("ROUTINE");
  await waitForListed(b, name);
  const cardUrl = `/casualties/card?id=${encodeURIComponent(id)}`;
  await a.goto(cardUrl);
  await b.goto(cardUrl);
  await expect(a.getByRole("radio", { name: "Urgent", exact: true }).first()).toBeVisible();
  await expect(b.getByRole("radio", { name: "Priority", exact: true }).first()).toBeVisible();
  await a.context().setOffline(true);
  await b.context().setOffline(true);
  await choosePriority(a, id, "Urgent");
  await b.waitForTimeout(1200);
  await choosePriority(b, id, "Priority");
  await reconnect(a);
  await reconnect(b);
  await expect.poll(async () => (await cardNamed(await serverCounts(name), name))?.evacPriority, { timeout: 30_000 }).toBe("PRIORITY");
  const counts = await serverCounts(name);
  const card = counts.cards[0]!;
  expect(counts.conflicts.some((conflict) => conflict.cardId === card.id && conflict.field === "evacPriority")).toBe(true);
  for (const device of [a, b]) {
    await waitForListed(device, name);
  }
  await expect
    .poll(
      async () => (await a.locator("[data-sync=conflict]").count()) + (await b.locator("[data-sync=conflict]").count()),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);

  let reviewed = false;
  for (const device of [a, b]) {
    await device.goto("/settings", { waitUntil: "domcontentloaded" });
    const field = device.getByText("card · evacPriority");
    const appeared = await field
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) continue;
    await expect(device.getByText("PRIORITY", { exact: true })).toBeVisible();
    await expect(device.getByText("URGENT", { exact: true })).toBeVisible();
    await device.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(device.getByText("No conflicts to review.")).toBeVisible();
    reviewed = true;
    break;
  }
  expect(reviewed).toBe(true);
});

test("T-08 a later vitals edit beats an earlier delete", async ({ twoDevices, serverCounts }) => {
  test.setTimeout(180_000);
  const { a, b } = await twoDevices();
  const name = tag("T08");
  await boot(a);
  await boot(b);
  const id = await createCasualty(a, name);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
  await a.goto(`/casualties/card/vitals?id=${encodeURIComponent(id)}`);
  await a.getByRole("button", { name: "Alert" }).click();
  await expect(a.getByText("Vital signs saved.")).toBeVisible();
  await expect.poll(async () => {
    const card = await cardNamed(await serverCounts(name), name);
    return card?.vitalSigns.some((vital) => vital.deletedAt == null) ?? false;
  }, { timeout: 20_000 }).toBe(true);
  const editor = `/casualties/card/edit?id=${encodeURIComponent(id)}&section=C`;
  await a.goto(editor);
  await expect(a.getByRole("heading", { name: "Edit card" })).toBeVisible();
  const vitalsA = a.getByRole("region", { name: "Vital signs" });
  await expect(vitalsA.getByRole("button", { name: "Remove" })).toBeVisible();
  await b.goto(editor);
  const vitalsB = b.getByRole("region", { name: "Vital signs" });
  await expect(vitalsB.getByRole("button", { name: "Remove" })).toBeVisible();
  await a.context().setOffline(true);
  await b.context().setOffline(true);
  await vitalsA.getByRole("button", { name: "Remove" }).click();
  await b.waitForTimeout(1200);
  await vitalsB.getByRole("list").getByRole("button").first().click();
  await vitalsB.getByRole("textbox", { name: "Pulse", exact: true }).fill("99");
  await vitalsB.getByRole("button", { name: "Add" }).click();
  await b.waitForTimeout(700);
  await reconnect(a);
  await reconnect(b);
  await expect.poll(async () => {
    const card = await cardNamed(await serverCounts(name), name);
    return card?.vitalSigns.find((vital) => vital.deletedAt == null)?.pulseRate ?? null;
  }, { timeout: 30_000 }).toBe(99);
});

test("T-10 a card syncs on Fast 3G", async ({ page, browserName, setOffline: offline, throttle, serverCounts }) => {
  test.skip(browserName !== "chromium", "CDP network throttling is Chromium-only. Repeat this timing run in Chrome.");
  const name = tag("T10");
  await boot(page);
  await offline(true);
  await createCasualty(page, name);
  await throttle("Fast 3G");
  const started = Date.now();
  await reconnect(page);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 30_000 }).toBe(1);
  const syncDurationMs = Date.now() - started;
  expect(syncDurationMs).toBeLessThan(20_000);
  await attachMetrics({ syncDurationMs, networkProfile: "Fast 3G", dataLossCount: 0, duplicateCount: 0 });
  await throttle(null);
});

test("T-12 offline cold start renders the shell", async ({ page, setOffline: offline }) => {
  await boot(page);
  await offline(true);
  const cold = await page.context().newPage();
  const started = Date.now();
  await cold.goto("/");
  await expect(cold.getByRole("heading", { name: "Casualties" })).toBeVisible();
  const timeToFirstRenderMs = Date.now() - started;
  expect(timeToFirstRenderMs).toBeLessThan(5_000);
  await attachMetrics({ timeToFirstRenderMs });
});

test("T-14 a clock one hour ahead still orders by HLC", async ({ twoDevices, serverCounts }) => {
  test.setTimeout(180_000);
  const { a, b } = await twoDevices();
  const name = tag("T14");
  await boot(a);
  await boot(b);
  const id = await createCasualty(a, name);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
  await waitForListed(b, name);
  // The edit screen reads the query on the client, so its static shell has no
  // name field. Open it while the clock is still running, then freeze time.
  await b.clock.install();
  await b.goto(`/casualties/card/edit?id=${encodeURIComponent(id)}&section=A`);
  await expect(b.getByTestId("patient-name-input")).toBeVisible();
  await b.context().setOffline(true);
  await b.clock.setFixedTime(Date.now() + 60 * 60 * 1000);
  // editField advances the fixed clock only long enough for the debounce, and
  // does not return until IndexedDB has the new name.
  await editField(b, id, "A", "Last name", `${name}-future`);
  await b.clock.setFixedTime(Date.now());
  await reconnect(b);
  await expect.poll(async () => (await cardNamed(await serverCounts(`${name}-future`), `${name}-future`)) != null, {
    timeout: 20_000,
  }).toBe(true);
  // Stay on the pre-pull version so the server compares HLC instead of taking the fast path.
  await a.context().setOffline(true);
  await editField(a, id, "A", "Last name", `${name}-past`);
  await reconnect(a);
  await expect.poll(async () => (await serverCounts(`${name}-future`)).cards.length, { timeout: 20_000 }).toBe(1);
  expect((await serverCounts(`${name}-past`)).cards).toHaveLength(0);
});

test("T-15 an invalid vitals payload is rejected without blocking a valid edit", async ({ page, serverCounts }) => {
  const name = tag("T15");
  await boot(page);
  const id = await createCasualty(page, name);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 20_000 }).toBe(1);
  await page.evaluate(async (cardId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tccc");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const meta = await new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => {
      const request = database.transaction("meta").objectStore("meta").getAll();
      request.onsuccess = () => resolve(request.result as Array<{ key: string; value: unknown }>);
      request.onerror = () => reject(request.error);
    });
    const card = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = database.transaction("casualties").objectStore("casualties").get(cardId);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    const deviceId = String(meta.find((entry) => entry.key === "deviceId")?.value);
    const wall = String(Date.now()).padStart(13, "0");
    const vitalId = crypto.randomUUID();
    const measuredAt = new Date().toISOString();
    const badHlc = `${wall}:0002:${deviceId}`;
    const noteHlc = `${wall}:0003:${deviceId}`;
    const baseVersion = (card.serverVersion as number | null) ?? 1;
    const rows = [
      {
        op: "child.upsert",
        entity: "vitalSigns",
        mutationId: crypto.randomUUID(),
        cardId,
        hlc: badHlc,
        baseVersion,
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
        row: {
          id: vitalId,
          cardId,
          clientUpdatedAt: badHlc,
          deletedAt: null,
          measuredAt,
          pulseRate: null,
          pulseLocation: null,
          systolic: null,
          diastolic: null,
          respiratoryRate: null,
          spo2: null,
          avpu: null,
          painScale: 15,
        },
      },
      {
        op: "card.upsert",
        mutationId: crypto.randomUUID(),
        cardId,
        hlc: noteHlc,
        baseVersion,
        status: "queued",
        attempts: 0,
        createdAt: Date.now() + 1,
        patch: { notes: "kept" },
        changedFields: ["notes"],
      },
    ];
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("outbox", "readwrite");
      const store = tx.objectStore("outbox");
      for (const row of rows) store.add(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    database.close();
  }, id);
  await manualSync(page);
  await expect.poll(async () => (await cardNamed(await serverCounts(name), name))?.notes, { timeout: 20_000 }).toBe("kept");
  const failed = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tccc");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<{ status?: string; lastError?: string }>>((resolve, reject) => {
        const request = database.transaction("outbox").objectStore("outbox").getAll();
        request.onsuccess = () => resolve(request.result as Array<{ status?: string; lastError?: string }>);
        request.onerror = () => reject(request.error);
      });
      return rows.filter((row) => row.status === "failed");
    } finally {
      database.close();
    }
  });
  expect(failed.length).toBeGreaterThan(0);
  expect(failed.some((row) => row.lastError?.includes("VALIDATION"))).toBe(true);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sync" })).toBeVisible();
  await expect(page.getByText(/VALIDATION/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(page.getByText("kept")).toHaveCount(0);
});
