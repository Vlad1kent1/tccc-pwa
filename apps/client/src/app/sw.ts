/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";
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

const navigationStrategy = new NetworkFirst({
  cacheName: "pages",
  networkTimeoutSeconds: 3,
  plugins: [
    {
      handlerDidError: async ({ request }) => {
        const path = new URL(request.url).pathname;
        return (
          (await serwist.matchPrecache(path)) ??
          (await serwist.matchPrecache("/~offline"))
        );
      },
    },
  ],
});

// PrecacheRoute serves precached URLs cache-first. Navigations must be
// NetworkFirst (3s) and only then fall back to the precached shell, then
// /~offline, so this listener runs before Serwist's fetch handler.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.stopImmediatePropagation();
  event.respondWith(navigationStrategy.handle({ event, request: event.request }));
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
