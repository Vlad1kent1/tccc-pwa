"use client";

import { useEffect, useMemo, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { Avpu, vitalSignsSchema, type Avpu as AvpuName, type VitalSigns } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";
import { childResolver } from "@/lib/forms/resolvers";
import { EnumChips } from "./enum-chips";
import { Field, fieldClass } from "./field";
import { NumericField } from "./numeric-field";
import { TimeInput } from "./time-input";
import type { RegisterSaver } from "./wizard-save";

type VitalForm = {
  measuredAt: string | null;
  pulseRate: number | null;
  pulseLocation: string | null;
  systolic: number | null;
  diastolic: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  avpu: AvpuName | null;
  painScale: number | null;
};

const empty = (): VitalForm => ({
  measuredAt: new Date().toISOString(),
  pulseRate: null,
  pulseLocation: null,
  systolic: null,
  diastolic: null,
  respiratoryRate: null,
  spo2: null,
  avpu: null,
  painScale: null,
});

const MEASUREMENTS = ["pulseRate", "pulseLocation", "systolic", "diastolic", "respiratoryRate", "spo2", "avpu", "painScale"] as const;

export function VitalsEditor({
  cardId,
  rows,
  register,
}: {
  cardId: string;
  rows: VitalSigns[];
  register: RegisterSaver;
}) {
  const { t, enumLabel } = useT();
  const editing = useRef<string | undefined>(undefined);
  const resolver = useMemo(() => childResolver<VitalForm>(vitalSignsSchema, cardId), [cardId]);
  const form = useForm<VitalForm>({ resolver, defaultValues: empty() });
  const active = rows.filter((row) => row.deletedAt == null);

  function dirty(values: VitalForm = form.getValues()): boolean {
    return Boolean(editing.current || MEASUREMENTS.some((key) => values[key] != null && values[key] !== ""));
  }

  async function saveForm(): Promise<boolean> {
    if (!dirty()) return true;
    const ok = await form.trigger();
    if (!ok) return false;
    const values = form.getValues();
    await casualtyRepo.upsertChild(cardId, "vitalSigns", {
      id: editing.current,
      measuredAt: values.measuredAt!,
      pulseRate: values.pulseRate,
      pulseLocation: values.pulseLocation,
      systolic: values.systolic,
      diastolic: values.diastolic,
      respiratoryRate: values.respiratoryRate,
      spo2: values.spo2,
      avpu: values.avpu,
      painScale: values.painScale,
    });
    editing.current = undefined;
    form.reset(empty());
    return true;
  }

  useEffect(
    () =>
      register("vitals", {
        save: async () => {
          if (dirty()) await saveForm();
        },
        validate: () => saveForm(),
      }),
    [register, form],
  );

  return (
    <div className="flex flex-col gap-4">
      {active.length === 0 ? <p className="text-sm text-muted">{t("wizard.vitalsEmpty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {active.map((row) => (
          <li key={row.id} className="row flex items-stretch gap-2">
            <button
              type="button"
              className="min-h-12 flex-1 px-3 py-2 text-left"
              onClick={() => {
                editing.current = row.id;
                form.reset({
                  measuredAt: row.measuredAt,
                  pulseRate: row.pulseRate,
                  pulseLocation: row.pulseLocation,
                  systolic: row.systolic,
                  diastolic: row.diastolic,
                  respiratoryRate: row.respiratoryRate,
                  spo2: row.spo2,
                  avpu: row.avpu,
                  painScale: row.painScale,
                });
              }}
            >
              <span className="block font-medium">{new Date(row.measuredAt).toLocaleString()}</span>
              <span className="block text-sm text-muted">{summary(row, enumLabel)}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => void casualtyRepo.deleteChild(cardId, "vitalSigns", row.id)}
            >
              {t("wizard.remove")}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void saveForm();
        }}
      >
        <Controller
          name="measuredAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <TimeInput label={t("wizard.fields.measuredAt")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="pulseRate"
            control={form.control}
            render={({ field, fieldState }) => (
              <NumericField label={t("wizard.fields.pulseRate")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
          <Controller
            name="pulseLocation"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field label={t("wizard.fields.pulseLocation")} error={fieldState.error?.message}>
                <input className={fieldClass} value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} />
              </Field>
            )}
          />
          <Controller
            name="systolic"
            control={form.control}
            render={({ field, fieldState }) => (
              <NumericField label={t("wizard.fields.systolic")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
          <Controller
            name="diastolic"
            control={form.control}
            render={({ field, fieldState }) => (
              <NumericField label={t("wizard.fields.diastolic")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
          <Controller
            name="respiratoryRate"
            control={form.control}
            render={({ field, fieldState }) => (
              <NumericField label={t("wizard.fields.respiratoryRate")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
          <Controller
            name="spo2"
            control={form.control}
            render={({ field, fieldState }) => (
              <NumericField label={t("wizard.fields.spo2")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
        </div>
        <Controller
          name="painScale"
          control={form.control}
          render={({ field, fieldState }) => (
            <NumericField label={t("wizard.fields.painScale")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller
          name="avpu"
          control={form.control}
          render={({ field, fieldState }) => (
            <EnumChips
              mode="single"
              label={t("wizard.fields.avpu")}
              enumName="Avpu"
              options={Object.values(Avpu)}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        {form.formState.errors.root?.message ? <p className="error-text">{form.formState.errors.root.message}</p> : null}
        <button type="submit" className="btn btn-primary">
          {t("wizard.add")}
        </button>
      </form>
    </div>
  );
}

function summary(row: VitalSigns, enumLabel: (group: "Avpu", value: string) => string): string {
  const parts = [
    row.pulseRate != null ? `P ${row.pulseRate}` : null,
    row.systolic != null || row.diastolic != null ? `BP ${row.systolic ?? "—"}/${row.diastolic ?? "—"}` : null,
    row.respiratoryRate != null ? `R ${row.respiratoryRate}` : null,
    row.spo2 != null ? `SpO2 ${row.spo2}` : null,
    row.avpu ? enumLabel("Avpu", row.avpu) : null,
    row.painScale != null ? `Pain ${row.painScale}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
