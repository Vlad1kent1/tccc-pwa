"use client";

import { createContext, useCallback, useContext, useId, useSyncExternalStore, type ReactNode } from "react";

/** Field values keyed by the field names of the official fillable PDF. */
export type Dd1380Values = Readonly<Record<string, string | boolean>>;

/**
 * Where the sheet reads and writes its values. The context carries this object,
 * which stays the same while the values change, and each field subscribes to its
 * own value. A keystroke then re-renders the one field it changed, not every field
 * and the ~160 injury targets on the figures.
 */
export interface Dd1380FormSource {
  /** The current values; the same object until they change. */
  getValues: () => Dd1380Values;
  subscribe: (listener: () => void) => () => void;
  patch: (changes: Record<string, string | boolean>) => void;
}

const FormContext = createContext<Dd1380FormSource | null>(null);
const SheetContext = createContext("dd1380");

/** `source` must keep its identity across renders (create it with `useMemo`), or every field re-renders. */
export function Dd1380FormProvider({ source, children }: { source: Dd1380FormSource; children: ReactNode }) {
  return <FormContext.Provider value={source}>{children}</FormContext.Provider>;
}

/** Scopes DOM ids to one side of the card; Battle Roster # and EVAC appear on both. */
export function SheetScope({ children }: { children: ReactNode }) {
  const id = useId();
  return <SheetContext.Provider value={id}>{children}</SheetContext.Provider>;
}

function useForm(): Dd1380FormSource {
  const context = useContext(FormContext);
  if (!context) throw new Error("DD1380 fields must render inside Dd1380FormProvider");
  return context;
}

/** One field's value; the component re-renders only when this value changes. */
function useFieldValue(name: string): string | boolean | undefined {
  const source = useForm();
  const read = () => source.getValues()[name];
  return useSyncExternalStore(source.subscribe, read, read);
}

export function useFieldId(name: string): string {
  return `${useContext(SheetContext)}-${name}`;
}

export function useTextValue(name: string): [string, (value: string) => void] {
  const source = useForm();
  const value = useFieldValue(name);
  const set = useCallback((next: string) => source.patch({ [name]: next }), [source, name]);
  return [typeof value === "string" ? value : "", set];
}

export function useChecked(name: string): [boolean, (checked: boolean) => void] {
  const source = useForm();
  const value = useFieldValue(name);
  const set = useCallback((next: boolean) => source.patch({ [name]: next }), [source, name]);
  return [value === true, set];
}

/**
 * Mutually exclusive boxes that can all be cleared, mirroring the PDF's scripts
 * (e.g. checking "M" unchecks "F").
 */
export function useExclusive(
  name: string,
  members: readonly string[],
): [boolean, (checked: boolean) => void] {
  const source = useForm();
  const value = useFieldValue(name);
  const set = useCallback(
    (next: boolean) => source.patch(Object.fromEntries(members.map((member) => [member, next && member === name]))),
    [source, name, members],
  );
  return [value === true, set];
}
