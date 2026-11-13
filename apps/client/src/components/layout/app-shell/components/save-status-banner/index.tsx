"use client";

import { useT } from "@/i18n/use-t";
import { en } from "@/i18n/en";
import { clearSaveStatus, retrySave, useSaveStatus, type SaveSource } from "@/lib/forms/save-status";

const SOURCES: SaveSource[] = ["board"];

// Outlined in the banner text color so it stays legible on the urgent background in every theme.
const BUTTON = "min-h-12 rounded-lg border-2 border-current px-4 font-semibold";

/** Board sections reported when one of their rows could not be stored. */
const SECTION_OF_SLICE: Record<string, keyof typeof en.wizard.sections> = {
  body: "B",
  vitals: "C",
  fluids: "E",
  meds: "F",
};

/**
 * Persistent alert while edits exist only on screen. It sits in the sticky header so
 * it stays visible at any scroll position, and it clears itself once a save succeeds.
 */
export function SaveStatusBanner() {
  const { t } = useT();
  const status = useSaveStatus();
  const failed = SOURCES.filter((source) => status[source].failed);
  const invalid = [...new Set(SOURCES.flatMap((source) => status[source].invalid))];
  if (failed.length === 0 && invalid.length === 0) return null;
  const retryable = failed.filter((source) => status[source].canRetry);
  const gone = failed.filter((source) => !status[source].canRetry);

  const label = (key: string) => {
    const section = SECTION_OF_SLICE[key];
    if (section) return t(`wizard.sections.${section}`);
    return key in en.wizard.fields ? t(`wizard.fields.${key}`) : key;
  };

  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 bg-urgent px-4 py-2 text-on-urgent">
      <div className="min-w-0">
        <p className="font-bold uppercase tracking-wide">{t("save.notSaved")}</p>
        {failed.length > 0 ? <p className="text-sm">{t("save.failed")}</p> : null}
        {invalid.length > 0 ? <p className="text-sm">{t("save.invalid", { fields: invalid.map(label).join(", ") })}</p> : null}
      </div>
      {failed.length > 0 ? (
        <div className="flex gap-2">
          {retryable.length > 0 ? (
            <button type="button" className={BUTTON} onClick={() => retryable.forEach(retrySave)}>
              {t("save.retry")}
            </button>
          ) : null}
          {/* A source that can no longer retry (its form closed) can only be acknowledged. */}
          {gone.length > 0 ? (
            <button type="button" className={BUTTON} onClick={() => gone.forEach(clearSaveStatus)}>
              {t("save.dismiss")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
