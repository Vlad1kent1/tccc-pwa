"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

/** Field values keyed by the field names of the official fillable PDF. */
export type Dd1380Values = Readonly<Record<string, string | boolean>>;

interface FormContextValue {
  values: Dd1380Values;
  patch: (changes: Record<string, string | boolean>) => void;
}

const FormContext = createContext<FormContextValue | null>(null);
const SheetContext = createContext("dd1380");

export function Dd1380FormProvider({
  values,
  onChange,
  children,
}: {
  values: Dd1380Values;
  onChange: (values: Dd1380Values) => void;
  children: ReactNode;
}) {
  const patch = (changes: Record<string, string | boolean>) => onChange({ ...values, ...changes });
  return <FormContext.Provider value={{ values, patch }}>{children}</FormContext.Provider>;
}

/** Scopes DOM ids to one side of the card; Battle Roster # and EVAC appear on both. */
export function SheetScope({ children }: { children: ReactNode }) {
  const id = useId();
  return <SheetContext.Provider value={id}>{children}</SheetContext.Provider>;
}

function useForm(): FormContextValue {
  const context = useContext(FormContext);
  if (!context) throw new Error("DD1380 fields must render inside Dd1380FormProvider");
  return context;
}

export function useFieldId(name: string): string {
  return `${useContext(SheetContext)}-${name}`;
}

export function useTextValue(name: string): [string, (value: string) => void] {
  const { values, patch } = useForm();
  const value = values[name];
  return [typeof value === "string" ? value : "", (next) => patch({ [name]: next })];
}

export function useChecked(name: string): [boolean, (checked: boolean) => void] {
  const { values, patch } = useForm();
  return [values[name] === true, (next) => patch({ [name]: next })];
}

/**
 * Mutually exclusive boxes that can all be cleared, mirroring the PDF's scripts
 * (e.g. checking "M" unchecks "F").
 */
export function useExclusive(
  name: string,
  members: readonly string[],
): [boolean, (checked: boolean) => void] {
  const { values, patch } = useForm();
  return [
    values[name] === true,
    (next) => patch(Object.fromEntries(members.map((member) => [member, next && member === name]))),
  ];
}
