"use client";

import { useEffect, type ReactNode } from "react";
import { Controller, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import {
  AirwayTreatment,
  BreathingTreatment,
  CirculationTreatment,
  EvacPriority,
  Gender,
  MechanismOfInjury,
  OtherTreatment,
  sectionASchema,
  sectionBSchema,
  sectionESchema,
  sectionGSchema,
  sectionHSchema,
} from "@tccc/shared";
import type { ZodType } from "zod";
import { useT } from "@/i18n/use-t";
import { casualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import { sharedResolver } from "@/lib/forms/resolvers";
import { BodyDiagram } from "./body-diagram";
import { EnumChips } from "./enum-chips";
import { Field, fieldClass } from "./field";
import { FluidList } from "./fluid-list";
import { MedicationList } from "./medication-list";
import { TimeInput } from "./time-input";
import { TourniquetGrid } from "./tourniquet-grid";
import { VitalsEditor } from "./vitals-editor";
import type { RegisterSaver } from "./wizard-save";

export type SectionEnsure = (schema: ZodType, values: unknown) => Promise<void>;

function SectionFields<T extends FieldValues>({
  name,
  schema,
  defaults,
  ensure,
  register,
  children,
}: {
  name: string;
  schema: ZodType<T>;
  defaults: T;
  ensure: SectionEnsure;
  register: RegisterSaver;
  children: (form: UseFormReturn<T>) => ReactNode;
}) {
  const form = useForm<T>({ resolver: sharedResolver(schema), defaultValues: defaults as never });

  useEffect(() => {
    let timer = 0;
    const save = async () => {
      window.clearTimeout(timer);
      await ensure(schema, form.getValues());
    };
    const stop = form.watch(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void save(), 400);
    });
    const unregister = register(name, {
      save,
      validate: async () => {
        await save();
        return form.trigger();
      },
    });
    return () => {
      window.clearTimeout(timer);
      stop.unsubscribe();
      unregister();
    };
  }, [ensure, form, name, register, schema]);

  return <div className="flex flex-col gap-4">{children(form as UseFormReturn<T>)}</div>;
}

export function SectionA({
  card,
  ensure,
  register,
  nameReady = true,
}: {
  card: LocalCasualtyCard | null;
  ensure: SectionEnsure;
  register: RegisterSaver;
  nameReady?: boolean;
}) {
  const { t } = useT();
  const defaults = {
    lastName: card?.lastName ?? null,
    firstName: card?.firstName ?? null,
    gender: card?.gender ?? null,
    injuredAt: card?.injuredAt ?? null,
    battleRosterNumber: card?.battleRosterNumber ?? null,
    evacPriority: card?.evacPriority ?? null,
    allergies: card?.allergies ?? null,
  };
  return (
    <SectionFields name="A" schema={sectionASchema} defaults={defaults} ensure={ensure} register={register}>
      {(form) => (
        <>
          <TextField
            form={form}
            name="lastName"
            label={t("wizard.fields.lastName")}
            testId="patient-name-input"
            disabled={!nameReady}
          />
          <TextField form={form} name="firstName" label={t("wizard.fields.firstName")} />
          <Controller
            name="gender"
            control={form.control}
            render={({ field, fieldState }) => (
              <EnumChips
                mode="single"
                label={t("wizard.fields.gender")}
                enumName="Gender"
                options={Object.values(Gender)}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            name="injuredAt"
            control={form.control}
            render={({ field, fieldState }) => (
              <TimeInput label={t("wizard.fields.injuredAt")} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
          <TextField form={form} name="battleRosterNumber" label={t("wizard.fields.battleRosterNumber")} />
          <Controller
            name="evacPriority"
            control={form.control}
            render={({ field, fieldState }) => (
              <EnumChips
                mode="single"
                label={t("wizard.fields.evacPriority")}
                enumName="EvacPriority"
                options={Object.values(EvacPriority)}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <TextField form={form} name="allergies" label={t("wizard.fields.allergies")} multiline />
        </>
      )}
    </SectionFields>
  );
}

export function SectionB({
  card,
  ensure,
  register,
}: {
  card: LocalCasualtyCard;
  ensure: SectionEnsure;
  register: RegisterSaver;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-6">
      <SectionFields
        name="B"
        schema={sectionBSchema}
        defaults={{ mechanisms: card.mechanisms, mechanismOther: card.mechanismOther }}
        ensure={ensure}
        register={register}
      >
        {(form) => <MechanismFields form={form} />}
      </SectionFields>
      <BodyDiagram
        sites={card.injurySites.filter((site) => site.deletedAt == null)}
        onAdd={(site) => void casualtyRepo.upsertChild(card.id, "injurySite", { ...site, description: null })}
        onUpdate={(site) => void casualtyRepo.upsertChild(card.id, "injurySite", site)}
        onDelete={(siteId) => void casualtyRepo.deleteChild(card.id, "injurySite", siteId)}
      />
      <TourniquetGrid cardId={card.id} rows={card.tourniquets} register={register} />
      <p className="sr-only">{t("wizard.bodyDiagram")}</p>
    </div>
  );
}

function MechanismFields({ form }: { form: UseFormReturn<any> }) {
  const { t } = useT();
  const mechanisms = form.watch("mechanisms");
  useEffect(() => {
    if (!mechanisms?.includes(MechanismOfInjury.OTHER) && form.getValues("mechanismOther")) {
      form.setValue("mechanismOther", null, { shouldDirty: true });
    }
  }, [form, mechanisms]);

  return (
    <>
      <Controller
        name="mechanisms"
        control={form.control}
        render={({ field, fieldState }) => (
          <EnumChips
            label={t("wizard.fields.mechanisms")}
            enumName="MechanismOfInjury"
            options={Object.values(MechanismOfInjury)}
            value={field.value ?? []}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      {mechanisms?.includes(MechanismOfInjury.OTHER) ? (
        <TextField form={form} name="mechanismOther" label={t("wizard.fields.mechanismOther")} />
      ) : null}
    </>
  );
}

export function SectionC({ card, register }: { card: LocalCasualtyCard; register: RegisterSaver }) {
  return <VitalsEditor cardId={card.id} rows={card.vitalSigns} register={register} />;
}

export function SectionE({
  card,
  ensure,
  register,
}: {
  card: LocalCasualtyCard;
  ensure: SectionEnsure;
  register: RegisterSaver;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-6">
      <SectionFields
        name="E"
        schema={sectionESchema}
        defaults={{
          circulation: card.circulation,
          airway: card.airway,
          breathing: card.breathing,
          otherTreatments: card.otherTreatments,
        }}
        ensure={ensure}
        register={register}
      >
        {(form) => (
          <>
            <ChipField form={form} name="circulation" label={t("wizard.fields.circulation")} enumName="CirculationTreatment" options={Object.values(CirculationTreatment)} />
            <ChipField form={form} name="airway" label={t("wizard.fields.airway")} enumName="AirwayTreatment" options={Object.values(AirwayTreatment)} />
            <ChipField form={form} name="breathing" label={t("wizard.fields.breathing")} enumName="BreathingTreatment" options={Object.values(BreathingTreatment)} />
            <ChipField form={form} name="otherTreatments" label={t("wizard.fields.otherTreatments")} enumName="OtherTreatment" options={Object.values(OtherTreatment)} />
          </>
        )}
      </SectionFields>
      <FluidList cardId={card.id} rows={card.fluids} register={register} />
    </div>
  );
}

export function SectionF({ card, register }: { card: LocalCasualtyCard; register: RegisterSaver }) {
  return <MedicationList cardId={card.id} rows={card.medications} register={register} />;
}

export function SectionG({
  card,
  ensure,
  register,
}: {
  card: LocalCasualtyCard | null;
  ensure: SectionEnsure;
  register: RegisterSaver;
}) {
  const { t } = useT();
  return (
    <SectionFields name="G" schema={sectionGSchema} defaults={{ notes: card?.notes ?? null }} ensure={ensure} register={register}>
      {(form) => <TextField form={form} name="notes" label={t("wizard.fields.notes")} multiline />}
    </SectionFields>
  );
}

export function SectionH({
  card,
  ensure,
  register,
}: {
  card: LocalCasualtyCard | null;
  ensure: SectionEnsure;
  register: RegisterSaver;
}) {
  const { t } = useT();
  return (
    <SectionFields
      name="H"
      schema={sectionHSchema}
      defaults={{ responderName: card?.responderName ?? null, responderLast4: card?.responderLast4 ?? null }}
      ensure={ensure}
      register={register}
    >
      {(form) => (
        <>
          <p className="text-sm text-muted">{t("wizard.prefilled")}</p>
          <TextField form={form} name="responderName" label={t("wizard.fields.responderName")} />
          <TextField form={form} name="responderLast4" label={t("wizard.fields.responderLast4")} />
        </>
      )}
    </SectionFields>
  );
}

function TextField({
  form,
  name,
  label,
  multiline = false,
  testId,
  disabled = false,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  name: string;
  label: string;
  multiline?: boolean;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field label={label} error={fieldState.error?.message}>
          {multiline ? (
            <textarea
              className={`${fieldClass} min-h-28 py-2`}
              data-testid={testId}
              disabled={disabled}
              value={field.value ?? ""}
              onChange={(event) => field.onChange(event.target.value || null)}
            />
          ) : (
            <input
              className={fieldClass}
              data-testid={testId}
              disabled={disabled}
              value={field.value ?? ""}
              onChange={(event) => field.onChange(event.target.value || null)}
            />
          )}
        </Field>
      )}
    />
  );
}

function ChipField({
  form,
  name,
  label,
  enumName,
  options,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  name: string;
  label: string;
  enumName: "CirculationTreatment" | "AirwayTreatment" | "BreathingTreatment" | "OtherTreatment";
  options: string[];
}) {
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <EnumChips
          label={label}
          enumName={enumName}
          options={options}
          value={field.value ?? []}
          onChange={field.onChange}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
