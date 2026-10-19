import {
  pullResponseSchema,
  pushResponseSchema,
  resolveConflictResponseSchema,
  type Mutation,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type ResolveConflictBody,
  type ResolveConflictResponse,
} from "@tccc/shared";
import { readUnitToken } from "./unit-token";

const TUNNEL_HEADERS = {
  "ngrok-skip-browser-warning": "true",
  "Bypass-Tunnel-Reminder": "true",
} as const;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (!configured) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  // Request paths already start with `/api`, so a value that ends in `/api` is the origin.
  return configured.replace(/\/api$/, "");
}

/** 408, 429, and 5xx, a network failure (`TypeError`), or an aborted or timed-out request (`DOMException`). */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || error instanceof DOMException;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Longest wait for one sync request, body included. A request nobody answers would otherwise
 * keep the sync lock forever, and every later sync in every tab would wait behind it.
 */
export const SYNC_REQUEST_TIMEOUT_MS = 45_000;

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await readUnitToken();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`No response within ${SYNC_REQUEST_TIMEOUT_MS} ms`, "TimeoutError"));
  }, SYNC_REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) forwardAbort();
  else init.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      ...init,
      signal: controller.signal,
      // Never let the HTTP cache answer a sync call; the worker already bypasses its own.
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        ...TUNNEL_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new ApiError(response.status, `${init.method ?? "GET"} ${path} failed (${response.status})`);
    }
    if (response.status === 204) return null;
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

function parse<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(502, `Invalid ${label} response`);
  }
  return parsed.data;
}

export interface HealthReport {
  status: string;
  db: string;
  serverTime: string;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  const body = await request("/api/health", { signal });
  if (!body || typeof body !== "object") {
    throw new ApiError(502, "Invalid health response");
  }
  const record = body as Record<string, unknown>;
  return {
    status: typeof record.status === "string" ? record.status : "ok",
    db: typeof record.db === "string" ? record.db : "ok",
    serverTime: typeof record.serverTime === "string" ? record.serverTime : new Date().toISOString(),
  };
}

export function pushMutations(deviceId: string, mutations: Mutation[], signal?: AbortSignal): Promise<PushResponse> {
  const body: PushRequest = { deviceId, mutations };
  return request("/api/sync/push", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  }).then((value) => parse(pushResponseSchema, value, "push"));
}

export function pullChanges(since: string, limit = 100, signal?: AbortSignal): Promise<PullResponse> {
  const params = new URLSearchParams({ since, limit: String(limit) });
  return request(`/api/sync/pull?${params.toString()}`, { signal }).then((value) =>
    parse(pullResponseSchema, value, "pull"),
  );
}

export function resolveConflict(
  id: string,
  choice: ResolveConflictBody["choice"],
  signal?: AbortSignal,
): Promise<ResolveConflictResponse> {
  return request(`/api/sync/conflicts/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ choice }),
    signal,
  }).then((value) => parse(resolveConflictResponseSchema, value, "resolve"));
}
