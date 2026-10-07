"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import { Avpu, vitalSignsSchema, type Avpu as AvpuName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";
import { childResolver } from "@/lib/forms/resolvers";
import { NumericField } from "@/components/ui/numeric-field";
import { TimeInput } from "@/components/ui/time-input";
import { CardLoading, MissingCard } from "@/components/ui/missing-card";
import { useLocalCard } from "@/components/pages/casualties/use-local-card";
import { VitalsTimeline } from "@/components/pages/casualties/vitals-timeline";

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

const MEASUREMENTS = ["pulseRate", "pulseLocation", "systolic", "diastolic", "respiratoryRate", "spo2", "avpu", "painScale"] as const;

function blank(): VitalForm {
  return {
    measuredAt: new Date().toISOString(),
    pulseRate: null,
    pulseLocation: null,
    systolic: null,
    diastolic: null,
    respiratoryRate: null,
    spo2: null,
    avpu: null,
    painScale: null,
  };
}

export function QuickVitalsForm() {
  const params = useSearchParams();
  const id = params.get("id");
  const card = useLocalCard(id);
  if (card === undefined) return <CardLoading />;
  if (!card || !id) return <MissingCard />;
  return <QuickForm cardId={card.id} rows={card.vitalSigns} />;
}

function QuickForm({ cardId, rows }: { cardId: string; rows: import("@tccc/shared").VitalSigns[] }) {
  const { t, enumLabel } = useT();
  const [saved, setSaved] = useState(false);
  const resolver = useMemo(() => childResolver<VitalForm>(vitalSignsSchema, cardId), [cardId]);
  const form = useForm<VitalForm>({ resolver, defaultValues: blank() });

  async function commit(partial: Partial<VitalForm> = {}): Promise<void> {
    for (const [key, value] of Object.entries(partial)) {
      form.setValue(key as keyof VitalForm, value as never);
    }
    const values = { ...form.getValues(), ...partial };
    const filled = MEASUREMENTS.some((key) => values[key] != null && values[key] !== "");
    if (!filled || !values.measuredAt) return;
    const ok = await form.trigger();
    if (!ok) return;
    await casualtyRepo.upsertChild(cardId, "vitalSigns", {
      measuredAt: values.measuredAt,
      pulseRate: values.pulseRate,
      pulseLocation: values.pulseLocation,
      systolic: values.systolic,
      diastolic: values.diastolic,
      respiratoryRate: values.respiratoryRate,
      spo2: values.spo2,
      avpu: values.avpu,
      painScale: values.painScale,
    });
    form.reset(blank());
    setSaved(true);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("card.quickTitle")}</h1>
        <Link href={`/casualties/card?id=${encodeURIComponent(cardId)}`} className="btn btn-ghost">
          {t("card.viewCard")}
        </Link>
      </div>
      <p className="text-sm text-muted">{t("card.quickHint")}</p>
      {saved ? <p role="status">{t("card.saved")}</p> : null}

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
            <NumericField autoFocus label={t("wizard.fields.pulseRate")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
        <Controller
          name="spo2"
          control={form.control}
          render={({ field, fieldState }) => (
            <NumericField label={t("wizard.fields.spo2")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
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
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t("wizard.fields.avpu")}</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(Avpu).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => void commit({ avpu: value })}
              className="btn btn-secondary min-h-16 text-lg"
            >
              {enumLabel("Avpu", value)}
            </button>
          ))}
        </div>
        {form.formState.errors.avpu?.message ? <p className="error-text mt-1">{form.formState.errors.avpu.message}</p> : null}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{t("wizard.fields.painScale")}</p>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 11 }, (_, score) => (
            <button
              key={score}
              type="button"
              onClick={() => void commit({ painScale: score })}
              className="btn btn-secondary size-14 px-0 text-xl"
            >
              {score}
            </button>
          ))}
        </div>
      </div>

      {form.formState.errors.root?.message ? <p className="error-text">{form.formState.errors.root.message}</p> : null}
      {form.formState.errors.systolic?.message ? <p className="error-text">{form.formState.errors.systolic.message}</p> : null}

      <button
        type="button"
        onClick={() => void commit()}
        className="btn btn-primary min-h-14 text-lg"
      >
        {t("wizard.save")}
      </button>

      <VitalsTimeline rows={rows} />
    </main>
  );
}
