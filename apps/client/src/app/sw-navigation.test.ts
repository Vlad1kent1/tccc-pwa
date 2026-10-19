import { describe, expect, it, vi } from "vitest";
import { respondNavigation, respondRsc, type NavigationDeps, type PageCache } from "./sw-navigation";

function memoryCache(entries: Record<string, string> = {}): PageCache & { stored: Map<string, string> } {
  const stored = new Map(Object.entries(entries));
  return {
    stored,
    match: async (request) => {
      const body = stored.get(request.url);
      return body == null ? undefined : new Response(body);
    },
    put: async (request, response) => {
      stored.set(request.url, await response.text());
    },
  };
}

/** A link that connects but never answers, until the request is aborted. */
function deadLink(_request: Request, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
}

function deps(overrides: Partial<NavigationDeps> = {}): NavigationDeps {
  return {
    matchShell: async () => undefined,
    matchOffline: async () => new Response("offline"),
    pages: memoryCache(),
    fetch: vi.fn(deadLink),
    waitUntil: vi.fn(),
    timeoutMs: 12_000,
    ...overrides,
  };
}

const page = (path: string) => new Request(`https://tccc.example${path}`, { mode: "same-origin" });

describe("respondNavigation", () => {
  it("opens a precached route at once, without touching the network", async () => {
    const fetch = vi.fn(deadLink);
    const started = Date.now();
    const response = await respondNavigation(
      page("/casualties/card?id=42"),
      deps({ fetch, matchShell: async (path) => (path === "/casualties/card" ? new Response("card shell") : undefined) }),
    );

    expect(await response.text()).toBe("card shell");
    expect(fetch).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("serves a stored page at once and refreshes it in the background", async () => {
    const pages = memoryCache({ "https://tccc.example/elsewhere": "old" });
    const waitUntil = vi.fn();
    const response = await respondNavigation(
      page("/elsewhere"),
      deps({ pages, waitUntil, fetch: async () => new Response("new") }),
    );

    expect(await response.text()).toBe("old");
    await waitUntil.mock.calls[0]![0];
    expect(pages.stored.get("https://tccc.example/elsewhere")).toBe("new");
  });

  it("falls back to the offline page when an unknown route gets no answer in time", async () => {
    const response = await respondNavigation(page("/unknown"), deps({ timeoutMs: 20 }));
    expect(await response.text()).toBe("offline");
  });

  it("returns what the network answers for a route it has not stored", async () => {
    const pages = memoryCache();
    const response = await respondNavigation(page("/unknown"), deps({ pages, fetch: async () => new Response("fresh") }));
    expect(await response.text()).toBe("fresh");
    expect(pages.stored.get("https://tccc.example/unknown")).toBe("fresh");
  });
});

describe("respondRsc", () => {
  const rsc = new Request("https://tccc.example/settings?_rsc=abc");

  it("gives up on a dead link after the deadline, so Next loads the page from the precache", async () => {
    const started = Date.now();
    const response = await respondRsc(rsc, { cache: memoryCache(), fetch: deadLink, timeoutMs: 20 });
    expect(response.type).toBe("error");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("uses a stored payload when the network fails, and stores a fresh one", async () => {
    const cache = memoryCache({ [rsc.url]: "stored" });
    expect(await (await respondRsc(rsc, { cache, fetch: deadLink, timeoutMs: 20 })).text()).toBe("stored");

    await respondRsc(rsc, { cache, fetch: async () => new Response("fresh"), timeoutMs: 20 });
    expect(cache.stored.get(rsc.url)).toBe("fresh");
  });
});
