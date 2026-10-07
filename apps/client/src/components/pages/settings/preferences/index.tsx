"use client";

import { useT } from "@/i18n/use-t";
import type { Locale } from "@/i18n/locale";
import { setTheme, useTheme, type Theme } from "@/lib/theme";

export function Preferences() {
  const { t, locale, setLocale } = useT();
  const theme = useTheme();
  const otherLocale: Locale = locale === "en" ? "uk" : "en";
  const otherLabel = otherLocale === "en" ? "English" : "Українська";
  const themes: { id: Theme; label: string }[] = [
    { id: "dark", label: t("prefs.dark") },
    { id: "contrast", label: t("prefs.contrast") },
  ];

  return (
    <div className="surface flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t("prefs.language")}</span>
        <button type="button" className="btn btn-secondary shrink-0" onClick={() => setLocale(otherLocale)}>
          {otherLabel}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="theme" className="text-sm font-medium">
          {t("prefs.theme")}
        </label>
        <select
          id="theme"
          className="input w-auto max-w-48"
          value={theme}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "dark" || next === "contrast") setTheme(next);
          }}
        >
          {themes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
