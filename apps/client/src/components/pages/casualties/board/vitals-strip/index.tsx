"use client";

import { memo, useState } from "react";
import { newId, type Avpu as AvpuName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { removeVital, upsertVital, useSlice } from "@/components/pages/casualties/board/store";

export const VitalsStrip = memo(function VitalsStrip() {
  const { t, enumLabel } = useT();
  const vitals = useSlice((state) => state.vitals);
  const [editing, setEditing] = useState<string | null>(null);
  const [pulse, setPulse] = useState("");

  function add(): void {
    const pulseRate = pulse.trim() ? Number(pulse) : null;
    if (pulseRate != null && !Number.isInteger(pulseRate)) return;
    const existing = vitals.find((row) => row.id === editing);
    const row = {
      id: existing?.id ?? newId(),
      cardId: existing?.cardId ?? "00000000-0000-4000-8000-000000000000",
      measuredAt: existing?.measuredAt ?? new Date().toISOString(),
      pulseRate: pulse.trim() === "" ? null : pulseRate,
      pulseLocation: existing?.pulseLocation ?? null,
      systolic: existing?.systolic ?? null,
      diastolic: existing?.diastolic ?? null,
      respiratoryRate: existing?.respiratoryRate ?? null,
      spo2: existing?.spo2 ?? null,
      avpu: (existing?.avpu ?? null) as AvpuName | null,
      painScale: existing?.painScale ?? null,
      clientUpdatedAt: existing?.clientUpdatedAt ?? "",
      deletedAt: null,
    };
    const hasMeasurement = [row.pulseRate, row.pulseLocation, row.systolic, row.diastolic, row.respiratoryRate, row.spo2, row.avpu, row.painScale].some(
      (item) => item != null && item !== "",
    );
    if (!hasMeasurement) return;
    upsertVital(row);
    setEditing(null);
    setPulse("");
  }

  return (
    <section aria-label={t("card.vitalsTitle")} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("card.vitalsTitle")}</h2>
      {vitals.length === 0 ? <p className="text-sm text-muted">{t("wizard.vitalsEmpty")}</p> : null}
      <ul aria-label={t("card.vitalsTitle")} className="flex flex-col gap-2">
        {vitals.map((row) => (
          <li key={row.id} className="flex items-stretch gap-2">
            <button
              type="button"
              className="btn btn-secondary min-h-14 flex-1 justify-start"
              onClick={() => {
                setEditing(row.id);
                setPulse(row.pulseRate == null ? "" : String(row.pulseRate));
              }}
            >
              {row.pulseRate != null ? `${t("wizard.fields.pulseRate")} ${row.pulseRate}` : new Date(row.measuredAt).toLocaleTimeString()}
              {row.avpu ? ` · ${enumLabel("Avpu", row.avpu)}` : ""}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => removeVital(row.id)}>
              {t("wizard.remove")}
            </button>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("wizard.fields.pulseRate")}</span>
        <input inputMode="numeric" className={`${fieldClass} min-h-14 text-2xl`} value={pulse} onChange={(event) => setPulse(event.target.value)} />
      </label>
      <button type="button" className="btn btn-primary min-h-14" onClick={add}>
        {t("wizard.add")}
      </button>
    </section>
  );
});
