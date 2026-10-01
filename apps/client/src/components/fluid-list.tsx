"use client";

import { useEffect, useMemo, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  FluidKind,
  Route,
  fluidSchema,
  type Fluid,
  type FluidKind as FluidKindName,
  type Route as RouteName,
} from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";
import { childResolver } from "@/lib/forms/resolvers";
import { EnumChips } from "./enum-chips";
import { Field, fieldClass } from "./field";
import { NumericField } from "./numeric-field";
import { TimeInput } from "./time-input";
import type { RegisterSaver } from "./wizard-save";

type FluidForm = {
  kind: FluidKindName | null;
  name: string | null;
  volumeMl: number | null;
  route: RouteName | null;
  administeredAt: string | null;
};

const empty = (): FluidForm => ({
  kind: null,
  name: null,
  volumeMl: null,
  route: null,
  administeredAt: new Date().toISOString(),
});

export function FluidList({
  cardId,
  rows,
  register,
}: {
  cardId: string;
  rows: Fluid[];
  register: RegisterSaver;
}) {
  const { t, enumLabel } = useT();
  const editing = useRef<string | undefined>(undefined);
  const resolver = useMemo(() => childResolver<FluidForm>(fluidSchema, cardId), [cardId]);
  const form = useForm<FluidForm>({ resolver, defaultValues: empty() });
  const active = rows.filter((row) => row.deletedAt == null);

  async function saveForm(): Promise<boolean> {
    const ok = await form.trigger();
    if (!ok) return false;
    const values = form.getValues();
    await casualtyRepo.upsertChild(cardId, "fluid", {
      id: editing.current,
      kind: values.kind!,
      name: values.name!.trim(),
      volumeMl: values.volumeMl!,
      route: values.route!,
      administeredAt: values.administeredAt!,
    });
    editing.current = undefined;
    form.reset(empty());
    return true;
  }

  function dirty(): boolean {
    const values = form.getValues();
    return Boolean(values.kind || values.name || values.volumeMl || values.route || editing.current);
  }

  useEffect(
    () =>
      register("fluids", {
        save: async () => {
          if (dirty() && (await form.trigger())) await saveForm();
        },
        validate: async () => (dirty() ? saveForm() : true),
      }),
    [register, form],
  );

  return (
    <div className="flex flex-col gap-4">
      {active.length === 0 ? <p className="text-sm text-muted">{t("wizard.fluidsEmpty")}</p> : null}
      <ul className="flex flex-col gap-2">
        {active.map((row) => (
          <li key={row.id} className="row flex items-stretch gap-2">
            <button
              type="button"
              className="min-h-12 flex-1 px-3 py-2 text-left"
              onClick={() => {
                editing.current = row.id;
                form.reset({
                  kind: row.kind,
                  name: row.name,
                  volumeMl: row.volumeMl,
                  route: row.route,
                  administeredAt: row.administeredAt,
                });
              }}
            >
              <span className="block font-medium">{row.name}</span>
              <span className="block text-sm text-muted">
                {enumLabel("FluidKind", row.kind)} · {row.volumeMl} mL · {enumLabel("Route", row.route)}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => void casualtyRepo.deleteChild(cardId, "fluid", row.id)}
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
          name="kind"
          control={form.control}
          render={({ field, fieldState }) => (
            <EnumChips
              mode="single"
              label={t("wizard.fields.kind")}
              enumName="FluidKind"
              options={Object.values(FluidKind)}
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
          name="volumeMl"
          control={form.control}
          render={({ field, fieldState }) => (
            <NumericField label={t("wizard.fields.volumeMl")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
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
        <button type="submit" className="btn btn-primary">
          {t("wizard.add")}
        </button>
      </form>
    </div>
  );
}
