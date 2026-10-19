/**
 * The server's clock as seen from this device. A phone set to the wrong time
 * would otherwise stamp clinical times wrongly and win, or lose, every
 * last-writer-wins merge by its clock error. The offset (server time minus device
 * time) is measured on every successful sync and persisted in `meta`; until the
 * first sync it is 0 and the device clock is used as is.
 */
let offsetMs = 0;

/** `Date.now()` corrected by the last measured server offset. Use it for every timestamp a mutation carries. */
export function getNetworkAdjustedTime(): number {
  return Date.now() + offsetMs;
}

export function networkNow(): Date {
  return new Date(getNetworkAdjustedTime());
}

export function networkNowIso(): string {
  return networkNow().toISOString();
}

export function getServerClockOffset(): number {
  return offsetMs;
}

export function setServerClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? Math.round(ms) : 0;
}
