import { test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { PROFILES, type NetworkProfile } from "./profiles";

export const API_ORIGIN = "http://127.0.0.1:4100";
const CLIENT_ORIGIN = "http://127.0.0.1:3100";

export interface ChaosPatch {
  latencyMs?: number;
  failureRate?: number;
  dropRate?: number;
}

export interface CountedCard {
  id: string;
  lastName: string | null;
  notes: string | null;
  allergies: string | null;
  evacPriority: string | null;
  vitalSigns: Array<{ deletedAt: string | null; pulseRate: number | null; painScale: number | null }>;
}

export interface ServerCounts {
  cards: CountedCard[];
  conflicts: Array<{ id: string; cardId: string; field: string; keptValue: unknown; discardedValue: unknown }>;
}

async function pullAll(api: APIRequestContext): Promise<CountedCard[]> {
  const cards: CountedCard[] = [];
  let since = "0";
  for (let page = 0; page < 50; page += 1) {
    const response = await api.get(`/api/sync/pull?since=${since}&limit=500`);
    if (!response.ok()) {
      throw new Error(`pull failed (${response.status()})`);
    }
    const body = (await response.json()) as {
      cards: CountedCard[];
      nextSince: string;
      hasMore: boolean;
    };
    cards.push(...body.cards);
    if (!body.hasMore) break;
    since = body.nextSince;
  }
  return cards;
}

export const test = base.extend<{
  /**
   * `offline(true | false)` from PLAN.md 6.2.
   * Registered as `setOffline` because Playwright already has an `offline` context option,
   * and a fixture with that name cannot depend on `context`.
   */
  setOffline: (value: boolean) => Promise<void>;
  throttle: (profile: NetworkProfile | null) => Promise<void>;
  twoDevices: () => Promise<{ a: Page; b: Page; contexts: [BrowserContext, BrowserContext] }>;
  serverCounts: (lastNamePrefix?: string) => Promise<ServerCounts>;
  setChaos: (patch: ChaosPatch) => Promise<void>;
}>({
  setOffline: async ({ context }, use) => {
    await use((value) => context.setOffline(value));
  },
  throttle: async ({ context, page, browserName }, use) => {
    await use(async (profile) => {
      if (browserName !== "chromium") {
        throw new Error("Network.emulateNetworkConditions is a Chromium CDP command");
      }
      const client = await context.newCDPSession(page);
      await client.send("Network.enable");
      if (!profile) {
        await client.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        return;
      }
      const selected = PROFILES[profile];
      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: selected.latency,
        downloadThroughput: selected.downloadThroughput,
        uploadThroughput: selected.uploadThroughput,
      });
    });
  },
  twoDevices: async ({ browser }, use) => {
    const opened: BrowserContext[] = [];
    await use(async () => {
      const first = await browser.newContext({ baseURL: CLIENT_ORIGIN });
      const second = await browser.newContext({ baseURL: CLIENT_ORIGIN });
      opened.push(first, second);
      const a = await first.newPage();
      const b = await second.newPage();
      return { a, b, contexts: [first, second] };
    });
    await Promise.all(opened.map((context) => context.close()));
  },
  serverCounts: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({ baseURL: API_ORIGIN });
    await use(async (lastNamePrefix) => {
      const cards = await pullAll(api);
      const conflictsResponse = await api.get("/api/sync/conflicts");
      if (!conflictsResponse.ok()) {
        throw new Error(`conflicts failed (${conflictsResponse.status()})`);
      }
      const conflicts = (await conflictsResponse.json()) as ServerCounts["conflicts"];
      const matching = lastNamePrefix
        ? cards.filter((card) => card.lastName?.startsWith(lastNamePrefix))
        : cards;
      return { cards: matching, conflicts };
    });
    await api.dispose();
  },
  setChaos: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({ baseURL: API_ORIGIN });
    await use(async (patch) => {
      const response = await api.post("/api/chaos", { data: patch });
      if (!response.ok()) {
        throw new Error(`chaos update failed (${response.status()}) ${await response.text()}`);
      }
    });
    await api.dispose();
  },
});

export { expect } from "@playwright/test";
