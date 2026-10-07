"use client";

import { memo } from "react";
import { EvacPriority, Gender } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { editIdentity, flushBoard, useSlice } from "@/components/pages/casualties/board/store";

export const IdentityBar = memo(function IdentityBar() {
  const { t, enumLabel } = useT();
  const identity = useSlice((state) => state.identity);

  return (
    <section aria-label={t("wizard.sections.A")} className="sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background py-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">{t("wizard.fields.lastName")}</span>
          <input
            data-testid="patient-name-input"
            className={`${fieldClass} min-h-14 text-lg`}
            value={identity.lastName ?? ""}
            onChange={(event) => editIdentity({ lastName: event.target.value || null })}
            onBlur={() => flushBoard()}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">{t("wizard.fields.allergies")}</span>
          <input
            className={`${fieldClass} min-h-14 text-lg`}
            value={identity.allergies ?? ""}
            onChange={(event) => editIdentity({ allergies: event.target.value || null })}
            onBlur={() => flushBoard()}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("wizard.fields.evacPriority")}</span>
        <div role="radiogroup" aria-label={t("wizard.fields.evacPriority")} className="grid grid-cols-3 gap-2">
          {Object.values(EvacPriority).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={identity.evacPriority === item}
              className={identity.evacPriority === item ? "chip chip-on min-h-14 text-base" : "chip min-h-14 text-base"}
              onClick={() => editIdentity({ evacPriority: identity.evacPriority === item ? null : item }, "now")}
            >
              {enumLabel("EvacPriority", item)}
            </button>
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-label={t("wizard.fields.gender")} className="grid grid-cols-2 gap-2">
        {Object.values(Gender).map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={identity.gender === item}
            className={identity.gender === item ? "chip chip-on min-h-14" : "chip min-h-14"}
            onClick={() => editIdentity({ gender: identity.gender === item ? null : item }, "now")}
          >
            {enumLabel("Gender", item)}
          </button>
        ))}
      </div>
    </section>
  );
});
