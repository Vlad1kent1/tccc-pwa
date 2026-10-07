"use client";

import { memo } from "react";
import { AirwayTreatment, BreathingTreatment, CirculationTreatment, OtherTreatment } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { toggleTreatment, useSlice } from "@/components/pages/casualties/board/store";
import type { BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

export const TreatmentRow = memo(function TreatmentRow() {
  const { t, enumLabel } = useT();
  const treatments = useSlice((state) => state.treatments);

  return (
    <section aria-label={t("wizard.sections.E")} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("wizard.sections.E")}</h2>
      <ChipRow label={t("wizard.fields.airway")} group="AirwayTreatment" options={Object.values(AirwayTreatment)} selected={treatments.airway} onToggle={(item) => toggleTreatment("airway", item)} enumLabel={enumLabel} />
      <ChipRow label={t("wizard.fields.breathing")} group="BreathingTreatment" options={Object.values(BreathingTreatment)} selected={treatments.breathing} onToggle={(item) => toggleTreatment("breathing", item)} enumLabel={enumLabel} />
      <ChipRow label={t("wizard.fields.circulation")} group="CirculationTreatment" options={Object.values(CirculationTreatment)} selected={treatments.circulation} onToggle={(item) => toggleTreatment("circulation", item)} enumLabel={enumLabel} />
      <ChipRow label={t("wizard.fields.otherTreatments")} group="OtherTreatment" options={Object.values(OtherTreatment)} selected={treatments.otherTreatments} onToggle={(item) => toggleTreatment("otherTreatments", item)} enumLabel={enumLabel} />
    </section>
  );
});

function ChipRow<T extends string>({
  label,
  group,
  options,
  selected,
  onToggle,
  enumLabel,
}: {
  label: string;
  group: "AirwayTreatment" | "BreathingTreatment" | "CirculationTreatment" | "OtherTreatment";
  options: T[];
  selected: BoardSnapshot["treatments"][keyof BoardSnapshot["treatments"]];
  onToggle: (item: T) => void;
  enumLabel: (group: "AirwayTreatment" | "BreathingTreatment" | "CirculationTreatment" | "OtherTreatment", value: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((item) => {
          const on = (selected as string[]).includes(item);
          return (
            <button key={item} type="button" aria-pressed={on} className={on ? "chip chip-on" : "chip"} onClick={() => onToggle(item)}>
              {enumLabel(group, item)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
