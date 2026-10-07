"use client";

import { memo, useState } from "react";
import { FluidKind, MedicationCategory, Route, newId } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import type { BoardSnapshot } from "@/components/pages/casualties/board/snapshot";
import { removeFluid, removeMedication, upsertFluid, upsertMedication, useSlice } from "@/components/pages/casualties/board/store";

export const FluidsMeds = memo(function FluidsMeds() {
  const { t } = useT();
  const fluids = useSlice((state) => state.fluids);
  const medications = useSlice((state) => state.medications);

  return (
    <div className="flex flex-col gap-6">
      <FluidBlock fluids={fluids} label={t("card.fluids")} />
      <MedBlock medications={medications} label={t("card.medications")} />
    </div>
  );
});

function FluidBlock({ fluids, label }: { fluids: BoardSnapshot["fluids"]; label: string }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [volume, setVolume] = useState("");

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{label}</h2>
      <ul className="flex flex-col gap-2">
        {fluids.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span className="min-h-12 flex-1 text-base">{row.name} · {row.volumeMl} mL</span>
            <button type="button" className="btn btn-secondary" onClick={() => removeFluid(row.id)}>
              {t("wizard.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <input aria-label={t("wizard.fields.name")} className={`${fieldClass} min-h-14`} value={name} onChange={(event) => setName(event.target.value)} />
        <input aria-label={t("wizard.fields.volumeMl")} inputMode="numeric" className={`${fieldClass} min-h-14`} value={volume} onChange={(event) => setVolume(event.target.value)} />
      </div>
      <button
        type="button"
        className="btn btn-secondary min-h-14"
        onClick={() => {
          const volumeMl = Number(volume);
          if (!name.trim() || !Number.isInteger(volumeMl) || volumeMl < 1) return;
          upsertFluid({
            id: newId(),
            cardId: "00000000-0000-4000-8000-000000000000",
            kind: FluidKind.FLUID,
            name: name.trim().slice(0, 100),
            volumeMl,
            route: Route.IV,
            administeredAt: new Date().toISOString(),
            clientUpdatedAt: "",
            deletedAt: null,
          });
          setName("");
          setVolume("");
        }}
      >
        {t("wizard.add")}
      </button>
    </section>
  );
}

function MedBlock({ medications, label }: { medications: BoardSnapshot["medications"]; label: string }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");

  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{label}</h2>
      <ul className="flex flex-col gap-2">
        {medications.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span className="min-h-12 flex-1 text-base">{row.name} · {row.dose}</span>
            <button type="button" className="btn btn-secondary" onClick={() => removeMedication(row.id)}>
              {t("wizard.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <input aria-label={t("wizard.fields.name")} className={`${fieldClass} min-h-14`} value={name} onChange={(event) => setName(event.target.value)} />
        <input aria-label={t("wizard.fields.dose")} className={`${fieldClass} min-h-14`} value={dose} onChange={(event) => setDose(event.target.value)} />
      </div>
      <button
        type="button"
        className="btn btn-secondary min-h-14"
        onClick={() => {
          if (!name.trim() || !dose.trim()) return;
          upsertMedication({
            id: newId(),
            cardId: "00000000-0000-4000-8000-000000000000",
            category: MedicationCategory.ANALGESIC,
            name: name.trim().slice(0, 100),
            dose: dose.trim().slice(0, 50),
            route: Route.IM,
            administeredAt: new Date().toISOString(),
            clientUpdatedAt: "",
            deletedAt: null,
          });
          setName("");
          setDose("");
        }}
      >
        {t("wizard.add")}
      </button>
    </section>
  );
}
