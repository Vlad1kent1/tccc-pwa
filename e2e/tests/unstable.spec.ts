import { expect, test } from "../src/fixtures";
import { boot, createCasualty, reconnect } from "../src/app";
import { attachMetrics } from "../src/metrics";

function tag(id: string): string {
  return `E2E-${id}-${Date.now().toString(36)}`;
}

test.afterEach(async ({ setChaos }) => {
  await setChaos({ latencyMs: 0, failureRate: 0, dropRate: 0 });
});

test.beforeEach(({ browserName }) => {
  test.skip(
    browserName !== "chromium",
    "WebKit aborts offline navigations, and CDP throttling is Chromium-only. Repeat these scenarios in Chromium.",
  );
});

test("T-10 a card syncs on Slow 3G", async ({ page, setOffline: offline, throttle, serverCounts }) => {
  test.setTimeout(90_000);
  const name = tag("T10S");
  await boot(page);
  await offline(true);
  await createCasualty(page, name);
  await throttle("Slow 3G");
  const started = Date.now();
  await reconnect(page);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 60_000 }).toBe(1);
  const syncDurationMs = Date.now() - started;
  await attachMetrics({ syncDurationMs, networkProfile: "Slow 3G", dataLossCount: 0, duplicateCount: 0 });
  await throttle(null);
});

test("T-10 a card syncs on Field 2G", async ({ page, setOffline: offline, throttle, serverCounts }) => {
  test.setTimeout(120_000);
  const name = tag("T10F");
  await boot(page);
  await offline(true);
  await createCasualty(page, name);
  await throttle("Field 2G");
  const started = Date.now();
  await reconnect(page);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 90_000 }).toBe(1);
  const syncDurationMs = Date.now() - started;
  await attachMetrics({ syncDurationMs, networkProfile: "Field 2G", dataLossCount: 0, duplicateCount: 0 });
  await throttle(null);
});

test("chaos latency still delivers one card", async ({ page, setChaos, serverCounts }) => {
  const name = tag("LAT");
  await boot(page);
  await setChaos({ latencyMs: 400 });
  const started = Date.now();
  await createCasualty(page, name);
  await expect.poll(async () => (await serverCounts(name)).cards.length, { timeout: 30_000 }).toBe(1);
  const found = await serverCounts(name);
  expect(new Set(found.cards.map((card) => card.id)).size).toBe(1);
  await attachMetrics({
    syncDurationMs: Date.now() - started,
    networkProfile: "chaos-latency",
    dataLossCount: 0,
    duplicateCount: 0,
  });
});
