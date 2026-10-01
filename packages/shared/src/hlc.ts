/**
 * Hybrid Logical Clock (Kulkarni et al., 2014).
 *
 * Serialized as "<wallTime:13 digits>:<counter:4 digits>:<nodeId>" so that plain
 * string comparison orders timestamps correctly, with nodeId as the tie-breaker.
 * The 13-digit wall time is valid until the year 2286.
 */

export interface HlcState {
  wallTime: number;
  counter: number;
  nodeId: string;
}

const WALL_DIGITS = 13;
const COUNTER_DIGITS = 4;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

export const HLC_PATTERN = /^(\d{13}):(\d{4}):(.+)$/;

export function initialHlc(nodeId: string): HlcState {
  return { wallTime: 0, counter: 0, nodeId };
}

// On counter overflow the logical wall time is advanced by 1 ms, which keeps the
// clock monotonic at the cost of a negligible drift from physical time.
function normalize(wallTime: number, counter: number, nodeId: string): HlcState {
  if (counter > MAX_COUNTER) {
    return { wallTime: wallTime + 1, counter: 0, nodeId };
  }
  return { wallTime, counter, nodeId };
}

/** Advances the clock for a local event. */
export function tickHlc(state: HlcState, physicalNow: number): HlcState {
  const wallTime = Math.max(state.wallTime, physicalNow);
  const counter = wallTime === state.wallTime ? state.counter + 1 : 0;
  return normalize(wallTime, counter, state.nodeId);
}

/** Merges a timestamp received from another node (or the server). */
export function receiveHlc(state: HlcState, remote: HlcState | string, physicalNow: number): HlcState {
  const r = typeof remote === "string" ? parseHlc(remote) : remote;
  const wallTime = Math.max(state.wallTime, r.wallTime, physicalNow);

  let counter: number;
  if (wallTime === state.wallTime && wallTime === r.wallTime) {
    counter = Math.max(state.counter, r.counter) + 1;
  } else if (wallTime === state.wallTime) {
    counter = state.counter + 1;
  } else if (wallTime === r.wallTime) {
    counter = r.counter + 1;
  } else {
    counter = 0;
  }
  return normalize(wallTime, counter, state.nodeId);
}

export function formatHlc(state: HlcState): string {
  return [
    state.wallTime.toString().padStart(WALL_DIGITS, "0"),
    state.counter.toString().padStart(COUNTER_DIGITS, "0"),
    state.nodeId,
  ].join(":");
}

export function parseHlc(value: string): HlcState {
  const match = HLC_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid HLC timestamp: ${value}`);
  }
  return { wallTime: Number(match[1]), counter: Number(match[2]), nodeId: match[3]! };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns true when `candidate` is strictly newer than `current` (a missing clock is oldest). */
export function isNewerHlc(candidate: string, current: string | undefined | null): boolean {
  return current == null || compareHlc(candidate, current) > 0;
}
