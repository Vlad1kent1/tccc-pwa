"use client";

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "contrast";

const STORAGE_KEY = "tccc.theme";

let theme: Theme = "dark";
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function applyTheme(next: Theme): void {
  document.documentElement.classList.toggle("contrast", next === "contrast");
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "contrast" ? "#000000" : "#0c1210");
}

export function getTheme(): Theme {
  return theme;
}

export function setTheme(next: Theme): void {
  theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The class still updates for this session.
  }
  applyTheme(next);
  emit();
}

export function loadStoredTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "contrast") setTheme(stored);
    else applyTheme("dark");
  } catch {
    applyTheme("dark");
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => "dark");
}
