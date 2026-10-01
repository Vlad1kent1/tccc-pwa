import {
  pullResponseSchema,
  pushResponseSchema,
  type Mutation,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "@tccc/shared";

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

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || error instanceof DOMException;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      ...TUNNEL_HEADERS,
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, `${init.method ?? "GET"} ${path} failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json() as Promise<unknown>;
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
