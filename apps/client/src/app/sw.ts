/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import { apiOrigin } from "../lib/sync/api";
import { pushOutboxFromWorker } from "../lib/sync/worker-push";
import { respondNavigation, respondRsc } from "./sw-navigation";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Origin of the sync API, inlined at build time by the Serwist route. Null when it is not configured. */
const API_ORIGIN = (() => {
  try {
    return new URL(apiOrigin()).origin;
  } catch {
    return null;
  }
})();

/**
 * Casualty data must never be stored by the worker, whatever origin the API is on.
 * A cached pull would also replay an old change feed and break cross-device sync.
 */
function isApiRequest(url: URL): boolean {
  return url.pathname.startsWith("/api/") || (API_ORIGIN !== null && url.origin === API_ORIGIN);
}

const PAGE_CACHE = "pages";
const RSC_CACHE = "pages-rsc";

/**
 * Removed when a new worker takes over. Before the API had its own NetworkOnly
 * rule, cross-origin pulls were stored in `cross-origin` and same-origin ones in
 * `apis`. Stored pages and RSC payloads point at the previous build's chunks,
 * which the new precache no longer holds.
 */
const STALE_CACHES = ["apis", "cross-origin", PAGE_CACHE, RSC_CACHE, "pages-rsc-prefetch"];

/** Only a route that is not precached waits on the network, and not past this. */
const NAVIGATION_TIMEOUT_MS = 12_000;
/** An in-app navigation waits this long before Next loads the page in full from the precache. */
const RSC_TIMEOUT_MS = 5_000;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  // Page loads are answered from the precache; a preload request would only spend data and battery.
  navigationPreload: false,
  runtimeCaching: [
    // Registered first so no API request reaches defaultCache, which uses
    // NetworkFirst for same-origin /api/ and for every cross-origin GET.
    {
      matcher: ({ url }) => isApiRequest(url),
      handler: new NetworkOnly(),
    },
    // defaultCache would wait on the network with no deadline.
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.headers.get("RSC") === "1",
      handler: async ({ request }) =>
        respondRsc(request, { cache: await caches.open(RSC_CACHE), fetch: (input, init) => fetch(input, init), timeoutMs: RSC_TIMEOUT_MS }),
    },
    {
      matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: new StaleWhileRevalidate({ cacheName: "images" }),
    },
    {
      matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2|font\.css)$/i,
      handler: new StaleWhileRevalidate({ cacheName: "fonts" }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.mode === "navigate";
        },
      },
    ],
  },
});

// PrecacheRoute alone would miss query-param routes (`/casualties/card?id=…`),
// and defaultCache would go to the network first. Page loads are answered here.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  if (isApiRequest(new URL(event.request.url))) return;
  event.stopImmediatePropagation();
  event.respondWith(
    caches.open(PAGE_CACHE).then((pages) =>
      respondNavigation(event.request, {
        matchShell: (path) => serwist.matchPrecache(path),
        matchOffline: () => serwist.matchPrecache("/~offline"),
        pages,
        fetch: (request, init) => fetch(request, init),
        waitUntil: (promise) => event.waitUntil(promise),
        timeoutMs: NAVIGATION_TIMEOUT_MS,
      }),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all(STALE_CACHES.map((name) => caches.delete(name))));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("sync", (event) => {
  const syncEvent = event as ExtendableEvent & { tag?: string };
  if (syncEvent.tag !== "tccc-outbox") return;
  syncEvent.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        if (clients.length > 0) {
          for (const client of clients) {
            client.postMessage({ type: "tccc-outbox", tag: "tccc-outbox" });
          }
          return;
        }
        await pushOutboxFromWorker();
      }),
  );
});

serwist.addEventListeners();
