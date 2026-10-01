/** Exponential backoff with full jitter. Base 1s, cap 60s (PLAN.md 4.3). */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 60_000;

export function backoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempts);
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const unit = Math.min(1, Math.max(0, random()));
  return Math.min(ceiling, Math.floor(unit * (ceiling + 1)));
}
