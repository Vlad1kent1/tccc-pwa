import { fetchHealth } from "./api";

export type Connectivity = "online" | "offline" | "degraded";

export const HEALTH_TIMEOUT_MS = 3_000;

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * `navigator.onLine` only reports the network interface. A 3s health probe
 * decides whether the server can actually be reached (PLAN.md 4.5).
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
  } catch {
    return "offline";
  } finally {
    clearTimeout(timer);
  }
}
