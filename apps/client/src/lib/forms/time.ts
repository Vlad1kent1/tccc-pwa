import { networkNow } from "@/lib/network-clock";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `datetime-local` value in the device timezone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Short local date and time for the card and the vitals table. */
export function formatStamp(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale === "uk" ? "uk-UA" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO timestamp with a timezone offset, or null when the input is empty. */
export function localInputToIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Local `HHMM` stamp used on the DD1380 time boxes. */
export function formatHmm(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Local `YYYY-MM-DD` value for `<input type="date">`. */
export function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Last `HHMM` or `H:MM` token in a time box. */
export function lastTimeToken(value: string): string {
  const matches = value.match(/\d{1,2}:\d{2}|\d{3,4}/g);
  return matches?.at(-1) ?? "";
}

/**
 * Writes the current `HHMM` into a time box, replacing whatever is already there.
 */
export function applyNowStamp(_current = "", now = networkNow()): string {
  return formatHmm(now.toISOString());
}

/** Keeps only the first four digits of a time box. */
export function maskHmm(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

/** A typed time may run this far ahead of the clock (drift, rounding up). Beyond it, the time is taken as yesterday's. */
export const FUTURE_TOLERANCE_MS = 10 * 60_000;

/** What a time-only entry (`HHMM`, no date) is placed against. */
export interface TimeAnchor {
  now?: Date;
  /** The value being corrected. The occurrence nearest to it is used, so an older row keeps its day. */
  near?: string | null;
  /** The injury time. A result before it moves forward a day if that does not put it in the future. */
  notBefore?: string | null;
}

interface Clock {
  hours: number;
  minutes: number;
}

function at(day: Date, clock: Clock, offsetDays = 0): Date {
  const date = new Date(day);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(clock.hours, clock.minutes, 0, 0);
  return date;
}

function validMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Places a typed `HHMM` on a day. A new entry gets the most recent past occurrence
 * (typing 2350 at 00:10 is 23:50 yesterday, not tonight). A correction gets the
 * occurrence nearest to the value it replaces. Neither is placed more than
 * `FUTURE_TOLERANCE_MS` ahead of `now`. Returns null for blank or invalid input.
 */
export function timeTokenToIso(token: string, anchor: TimeAnchor = {}): string | null {
  const clock = parseClock(token);
  if (!clock) return null;
  const now = anchor.now ?? networkNow();
  const latest = now.getTime() + FUTURE_TOLERANCE_MS;

  const nearMs = validMs(anchor.near);
  let result: Date;
  if (nearMs != null) {
    const near = new Date(nearMs);
    result = [-1, 0, 1]
      .map((offset) => at(near, clock, offset))
      .reduce((best, candidate) =>
        Math.abs(candidate.getTime() - nearMs) < Math.abs(best.getTime() - nearMs) ? candidate : best,
      );
  } else {
    result = at(now, clock);
  }
  while (result.getTime() > latest) result = at(result, clock, -1);

  const injuryMs = validMs(anchor.notBefore);
  if (injuryMs != null && result.getTime() < injuryMs) {
    const nextDay = at(result, clock, 1);
    if (nextDay.getTime() <= latest) result = nextDay;
  }
  return result.toISOString();
}

/**
 * Combines a date input and a time box. Returns null when both are empty (cleared),
 * and `undefined` while the time is missing or unfinished: nothing is saved, and no
 * midnight is made up. Without a date, the time is placed by `timeTokenToIso`.
 */
export function joinDateAndTime(
  date: string,
  timeText: string,
  previous: string | null,
  now = networkNow(),
): string | null | undefined {
  const token = lastTimeToken(timeText);
  if (!date && !timeText.trim()) return null;
  const clock = parseClock(token);
  if (!clock) return undefined;
  if (!date) return timeTokenToIso(token, { now, near: previous }) ?? undefined;
  const [year, month, dayNum] = date.split("-").map(Number);
  if (!year || !month || !dayNum) return undefined;
  const result = new Date(year, month - 1, dayNum, clock.hours, clock.minutes, 0, 0);
  return Number.isNaN(result.getTime()) ? undefined : result.toISOString();
}

/** Same minute, ignoring seconds. Paper time boxes hold `HHMM`, so a re-read is never more precise. */
export function sameMinute(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = validMs(a);
  const right = validMs(b);
  if (left == null || right == null) return left === right;
  return Math.floor(left / 60_000) === Math.floor(right / 60_000);
}

function parseClock(value: string): Clock | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/) ?? trimmed.match(/^(\d{1,2})(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}
