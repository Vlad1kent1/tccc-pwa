"use client";

import { memo } from "react";
import { MechanismOfInjury } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { editMechanism, flushBoard, toggleMechanism, useSlice } from "@/components/pages/casualties/board/store";

export const MechanismRow = memo(function MechanismRow() {
  const { t, enumLabel } = useT();
  const mechanism = useSlice((state) => state.mechanism);
  const other = mechanism.mechanisms.includes(MechanismOfInjury.OTHER);

  return (
    <section aria-label={t("wizard.fields.mechanisms")} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("wizard.fields.mechanisms")}</h2>
      <div className="flex flex-wrap gap-2">
        {Object.values(MechanismOfInjury).map((item) => {
          const on = mechanism.mechanisms.includes(item);
          return (
            <button key={item} type="button" aria-pressed={on} className={on ? "chip chip-on" : "chip"} onClick={() => toggleMechanism(item)}>
              {enumLabel("MechanismOfInjury", item)}
            </button>
          );
        })}
      </div>
      {other ? (
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">{t("wizard.fields.mechanismOther")}</span>
          <input
            className={`${fieldClass} min-h-14`}
            value={mechanism.mechanismOther ?? ""}
            onChange={(event) => editMechanism({ mechanismOther: event.target.value || null }, "debounce")}
            onBlur={() => flushBoard()}
          />
        </label>
      ) : null}
    </section>
  );
});
