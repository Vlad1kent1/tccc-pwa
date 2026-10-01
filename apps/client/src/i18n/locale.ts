"use client";

import { useSyncExternalStore } from "react";
import { db, getMeta, setMeta } from "@/lib/db";

export type Locale = "en" | "uk";

const LEGACY_KEY = "tccc.locale";

let locale: Locale = "en";
let localeEpoch = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function applyLocale(next: Locale): void {
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  emit();
}

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "uk";
}

export function getLocale(): Locale {
  return locale;
}

/** Updates the in-memory locale immediately and persists it in the Dexie `meta` store. */
export function setLocale(next: Locale): void {
  localeEpoch += 1;
  applyLocale(next);
  void setMeta(db, "locale", next);
}

/**
 * Loads the locale from Dexie. A value left in `localStorage` by an older
 * build is copied once and then removed.
 */
export async function loadStoredLocale(): Promise<void> {
  const epoch = localeEpoch;
  const stored = await getMeta(db, "locale");
  if (epoch !== localeEpoch) return;
  if (isLocale(stored)) {
    applyLocale(stored);
    return;
  }

  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    legacy = null;
  }
  if (epoch !== localeEpoch) return;
  const next: Locale = legacy === "uk" ? "uk" : "en";
  applyLocale(next);
  await setMeta(db, "locale", next);
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // The Dexie copy is the source of truth either way.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => "en");
}
