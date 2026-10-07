/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
import { pushOutboxFromWorker } from "../lib/sync/worker-push";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Registered before defaultCache so /api/* is never stored. defaultCache
    // would otherwise use NetworkFirst for GET /api/.
    {
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
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

const PAGE_CACHE = "pages";
/** Field 2G needs more than one 3s round trip before the cached shell is used. */
const NAVIGATION_TIMEOUT_MS = 12_000;

async function asDocument(response: Response): Promise<Response> {
  if (!response.redirected) return response;
  const headers = new Headers(response.headers);
  headers.delete("location");
  return new Response(await response.blob(), { status: 200, statusText: "OK", headers });
}

async function respondNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(PAGE_CACHE);
  const path = new URL(request.url).pathname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
  } catch {
    // Offline, timed out, or aborted. Fall through to a stored document.
  } finally {
    clearTimeout(timer);
  }
  const cached =
    (await cache.match(request, { ignoreVary: true })) ??
    (await serwist.matchPrecache(path)) ??
    (await serwist.matchPrecache("/~offline"));
  if (cached) return asDocument(cached);
  return Response.error();
}

// PrecacheRoute serves precached URLs cache-first. Navigations must try the
// network, then the page cache (ignoring Vary), then the precached shell.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.stopImmediatePropagation();
  event.respondWith(respondNavigation(event.request));
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
