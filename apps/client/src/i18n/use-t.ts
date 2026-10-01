"use client";

import { ENUMS } from "@tccc/shared";
import { en } from "./en";
import { getLocale, setLocale, useLocale, type Locale } from "./locale";
import { uk } from "./uk";

type EnumName = keyof typeof ENUMS;

function lookup(locale: Locale, path: string): string {
  const messages = locale === "uk" ? uk : en;
  const value = path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, messages);
  return typeof value === "string" ? value : path;
}

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function translate(path: string, vars?: Record<string, string | number>, locale: Locale = getLocale()): string {
  return fill(lookup(locale, path), vars);
}

export function enumLabel(group: EnumName, value: string, locale: Locale = getLocale()): string {
  const messages = locale === "uk" ? uk : en;
  const table = messages.enums[group] as Record<string, string>;
  return table[value] ?? value;
}

export function useT() {
  const locale = useLocale();
  return {
    locale,
    setLocale,
    t: (path: string, vars?: Record<string, string | number>) => translate(path, vars, locale),
    enumLabel: (group: EnumName, value: string) => enumLabel(group, value, locale),
  };
}
