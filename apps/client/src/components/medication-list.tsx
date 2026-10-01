"use client";

import { useEffect, useMemo, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import {
  MedicationCategory,
  Route,
  medicationSchema,
  type Medication,
  type MedicationCategory as MedicationCategoryName,
  type Route as RouteName,
} from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";
import { childResolver } from "@/lib/forms/resolvers";
import { EnumChips } from "./enum-chips";
import { Field, fieldClass } from "./field";
import { TimeInput } from "./time-input";
import type { RegisterSaver } from "./wizard-save";

type MedicationForm = {
  category: MedicationCategoryName | null;
  name: string | null;
  dose: string | null;
  route: RouteName | null;
  administeredAt: string | null;
};

const empty = (): MedicationForm => ({
  category: null,
  name: null,
  dose: null,
  route: null,
  administeredAt: new Date().toISOString(),
});

export function MedicationList({
  cardId,
  rows,
  register,
}: {
  cardId: string;
  rows: Medication[];
  register: RegisterSaver;
}) {
  const { t, enumLabel } = useT();
  const editing = useRef<string | undefined>(undefined);
  const resolver = useMemo(() => childResolver<MedicationForm>(medicationSchema, cardId), [cardId]);
  const form = useForm<MedicationForm>({ resolver, defaultValues: empty() });
  const active = rows.filter((row) => row.deletedAt == null);

  async function saveForm(): Promise<boolean> {
    const ok = await form.trigger();
    if (!ok) return false;
    const values = form.getValues();
    await casualtyRepo.upsertChild(cardId, "medication", {
      id: editing.current,
      category: values.category!,
      name: values.name!.trim(),
      dose: values.dose!.trim(),
      route: values.route!,
      administeredAt: values.administeredAt!,
    });
    editing.current = undefined;
    form.reset(empty());
    return true;
  }

  function dirty(): boolean {
    const values = form.getValues();
    return Boolean(values.category || values.name || values.dose || values.route || editing.current);
  }

  useEffect(
    () =>
      register("medications", {
        save: async () => {
          if (dirty() && (await form.trigger())) await saveForm();
        },
        validate: async () => (dirty() ? saveForm() : true),
      }),
    [register, form],
  );

  return (
    <div className="flex flex-col gap-4">
      {active.length === 0 ? <p className="text-sm text-muted">{t("wizard.medsEmpty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {active.map((row) => (
          <li key={row.id} className="row flex items-stretch gap-2">
            <button
              type="button"
              className="min-h-12 flex-1 px-3 py-2 text-left"
              onClick={() => {
                editing.current = row.id;
                form.reset({
                  category: row.category,
                  name: row.name,
                  dose: row.dose,
                  route: row.route,
                  administeredAt: row.administeredAt,
                });
              }}
            >
              <span className="block font-medium">{row.name}</span>
              <span className="block text-sm text-muted">
                {enumLabel("MedicationCategory", row.category)} · {row.dose} · {enumLabel("Route", row.route)}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => void casualtyRepo.deleteChild(cardId, "medication", row.id)}
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
          name="category"
          control={form.control}
          render={({ field, fieldState }) => (
            <EnumChips
              mode="single"
              label={t("wizard.fields.category")}
              enumName="MedicationCategory"
              options={Object.values(MedicationCategory)}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field label={t("wizard.fields.name")} error={fieldState.error?.message}>
              <input className={fieldClass} value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} />
            </Field>
          )}
        />
        <Controller
          name="dose"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field label={t("wizard.fields.dose")} error={fieldState.error?.message}>
              <input className={fieldClass} value={field.value ?? ""} onChange={(event) => field.onChange(event.target.value || null)} />
            </Field>
          )}
        />
        <Controller
          name="route"
          control={form.control}
          render={({ field, fieldState }) => (
            <EnumChips
              mode="single"
              label={t("wizard.fields.route")}
              enumName="Route"
              options={Object.values(Route)}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          name="administeredAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <TimeInput label={t("wizard.fields.administeredAt")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
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
