export interface ChaosSettings {
  enabled: boolean;
  /** Upper bound of a random delay applied before the handler runs. */
  latencyMs: number;
  /** Probability from 0 to 1 of answering 503 before the handler runs. */
  failureRate: number;
  /** Probability from 0 to 1 of closing the socket after the handler finishes (after the DB commit). */
  dropRate: number;
}

function readNumber(name: string): number {
  const value = Number(process.env[name] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export const chaosState: ChaosSettings = {
  enabled: process.env.CHAOS_ENABLED === 'true',
  latencyMs: Math.max(0, readNumber('CHAOS_LATENCY_MS')),
  failureRate: clamp01(readNumber('CHAOS_FAILURE_RATE')),
  dropRate: clamp01(readNumber('CHAOS_DROP_RATE')),
};

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function updateChaos(patch: Partial<Omit<ChaosSettings, 'enabled'>>): ChaosSettings {
  if (patch.latencyMs != null) chaosState.latencyMs = Math.max(0, patch.latencyMs);
  if (patch.failureRate != null) chaosState.failureRate = clamp01(patch.failureRate);
  if (patch.dropRate != null) chaosState.dropRate = clamp01(patch.dropRate);
  return { ...chaosState };
}
