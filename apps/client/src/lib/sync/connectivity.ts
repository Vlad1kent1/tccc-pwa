import { fetchHealth } from "./api";

export type Connectivity = "online" | "offline" | "degraded" | "unknown";

/** Field 2G is a 3s round trip, so the probe must outlast more than one of those. */
export const HEALTH_TIMEOUT_MS = 12_000;

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * `navigator.onLine` only reports the network interface. The health probe
 * decides whether the server can actually be reached (PLAN.md 4.5).
 * A probe that runs out of time is `unknown`: the outbox is still tried once.
 * `offline` is reserved for a missing network or a failed request.
 * `degraded` means the server answered but reported the database as down.
 */
export async function probeConnectivity(
  probe: (signal: AbortSignal) => Promise<{ db: string }> = fetchHealth,
): Promise<Connectivity> {
  if (!browserOnline()) return "offline";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const health = await probe(controller.signal);
    return health.db === "ok" || health.db === "up" ? "online" : "degraded";
  } catch (error) {
    return isTimeout(error) ? "unknown" : "offline";
  } finally {
    clearTimeout(timer);
  }
}
