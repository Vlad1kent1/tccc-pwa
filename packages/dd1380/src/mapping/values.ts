import type { Dd1380Values } from "../types";

export function str(value: Dd1380Values[string] | undefined): string {
  return typeof value === "string" ? value : "";
}

export function on(values: Dd1380Values, name: string): boolean {
  return values[name] === true;
}

export function active<T extends { deletedAt: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.deletedAt == null);
}
