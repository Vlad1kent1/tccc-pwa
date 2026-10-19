/**
 * How the service worker answers page loads and RSC requests. Kept apart from
 * `sw.ts` so it can be tested without a worker.
 *
 * Page loads are cache first. Every route of the app is a static shell precached
 * with this build, so a page opens at once in a dead zone instead of waiting out a
 * network timeout. A newer build reaches the device as a new worker (the update
 * banner), not through these requests.
 */

export interface PageCache {
  match(request: Request, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface NavigationDeps {
  /** The shell precached with this build for a route path, if it is one. */
  matchShell(path: string): Promise<Response | undefined>;
  /** The offline page, precached. */
  matchOffline(): Promise<Response | undefined>;
  pages: PageCache;
  fetch(request: Request, init: RequestInit): Promise<Response>;
  /** Keeps the worker alive for background work that outlives the response. */
  waitUntil(promise: Promise<unknown>): void;
  timeoutMs: number;
}

/** Safari refuses a redirected response for a navigation; serve its body as a plain 200. */
export async function asDocument(response: Response): Promise<Response> {
  if (!response.redirected) return response;
  const headers = new Headers(response.headers);
  headers.delete("location");
  return new Response(await response.blob(), { status: 200, statusText: "OK", headers });
}

/** Rejects once `timeoutMs` passes, aborting the request. */
export async function fetchWithDeadline(
  fetcher: (request: Request, init: RequestInit) => Promise<Response>,
  request: Request,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`No response within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetcher(request, { signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1. The precached shell of the route: instant, and always from this build.
 * 2. A page stored on an earlier visit, refreshed in the background.
 * 3. The network, within `timeoutMs`; then the offline page.
 */
export async function respondNavigation(request: Request, deps: NavigationDeps): Promise<Response> {
  const shell = await deps.matchShell(new URL(request.url).pathname);
  if (shell) return asDocument(shell);

  const stored = await deps.pages.match(request, { ignoreVary: true });
  const network = fetchWithDeadline(deps.fetch, request, deps.timeoutMs).then(async (response) => {
    if (response.ok) await deps.pages.put(request, response.clone());
    return response;
  });
  if (stored) {
    deps.waitUntil(network.catch(() => undefined));
    return asDocument(stored);
  }
  try {
    return await network;
  } catch {
    // Offline, or the link is too slow to answer in time.
  }
  const offline = await deps.matchOffline();
  return offline ? asDocument(offline) : Response.error();
}

/**
 * RSC payloads for in-app navigation, within a short deadline. When the network
 * cannot answer in time, a stored payload is used, or the request fails at once;
 * Next then loads the page in full, which `respondNavigation` serves from the
 * precache. Waiting out a dead link here would freeze every tap on a link.
 */
export async function respondRsc(
  request: Request,
  deps: { cache: PageCache; fetch: NavigationDeps["fetch"]; timeoutMs: number },
): Promise<Response> {
  try {
    const response = await fetchWithDeadline(deps.fetch, request, deps.timeoutMs);
    if (response.ok) await deps.cache.put(request, response.clone());
    return response;
  } catch {
    return (await deps.cache.match(request)) ?? Response.error();
  }
}
