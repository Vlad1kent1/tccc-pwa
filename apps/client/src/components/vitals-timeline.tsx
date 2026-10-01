"use client";

import type { VitalSigns } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { formatStamp } from "@/lib/forms/time";

export function VitalsTimeline({ rows }: { rows: VitalSigns[] }) {
  const { t, locale, enumLabel } = useT();
  const active = rows
    .filter((row) => row.deletedAt == null)
    .slice()
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));

  if (active.length === 0) {
    return <p className="text-sm">{t("wizard.vitalsEmpty")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th>{t("card.columns.time")}</th>
            <th>{t("card.columns.pulse")}</th>
            <th>{t("card.columns.bp")}</th>
            <th>{t("card.columns.rr")}</th>
            <th>{t("card.columns.spo2")}</th>
            <th>{t("card.columns.avpu")}</th>
            <th>{t("card.columns.pain")}</th>
          </tr>
        </thead>
        <tbody>
          {active.map((row) => (
            <tr key={row.id}>
              <td>{formatStamp(row.measuredAt, locale)}</td>
              <td>
                {row.pulseRate ?? t("card.none")}
                {row.pulseLocation ? ` ${row.pulseLocation}` : ""}
              </td>
              <td>{row.systolic != null || row.diastolic != null ? `${row.systolic ?? "—"}/${row.diastolic ?? "—"}` : t("card.none")}</td>
              <td>{row.respiratoryRate ?? t("card.none")}</td>
              <td>{row.spo2 ?? t("card.none")}</td>
              <td>{row.avpu ? enumLabel("Avpu", row.avpu) : t("card.none")}</td>
              <td>{row.painScale ?? t("card.none")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
