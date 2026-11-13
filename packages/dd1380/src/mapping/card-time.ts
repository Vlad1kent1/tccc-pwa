const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatCardDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getDate())}-${MONTHS[date.getMonth()]}-${String(date.getFullYear()).slice(2)}`;
}

export function formatCardTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function parseDdMmmYy(value: string): Date | null {
  const match = value.trim().toUpperCase().match(/^(\d{1,2})[- ]([A-Z]{3})[- ](\d{2}|\d{4})$/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2] as (typeof MONTHS)[number]);
  if (month < 0) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(year, month, Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseHmm(value: string): { hours: number; minutes: number } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/) ?? trimmed.match(/^(\d{2})(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}
