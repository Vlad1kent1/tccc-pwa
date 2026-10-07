"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useLocale } from "@/i18n/locale";
import { SheetScope, useChecked, useExclusive, useFieldId, useTextValue } from "@/components/pages/casualties/dd1380/form-context";
import { AVPU_CHOICES, PAIN_CHOICES, ROUTE_OPTIONS } from "@/components/pages/casualties/dd1380/options";

/** Square-cornered sheet. Everything printed on the Ukrainian card sits inside this border. */
export function UaSheet({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`@container flex h-full min-w-0 flex-col print:m-0 print:h-auto print:flex-none print:break-inside-avoid print:shadow-none ${className}`}>
      <SheetScope>
        <section
          aria-label={label}
          className="dd-sheet flex h-full flex-1 flex-col border-4 border-black bg-white leading-[1.15] text-black print:m-0 print:h-auto print:flex-none print:border-none print:shadow-none print:break-inside-avoid"
          style={{ fontSize: "clamp(8px, 2.05cqw, 12.5px)" }}
        >
          {children}
        </section>
      </SheetScope>
    </div>
  );
}

export function DropHeading({ cap, rest, note }: { cap: string; rest: string; note?: string }) {
  return (
    <h2 className="leading-none font-bold">
      {cap ? <span className="text-[1.35em]">{cap}</span> : null}
      <span>{rest}</span>
      {note ? <span className="text-[0.85em] font-normal italic">{note}</span> : null}
    </h2>
  );
}

export function Dash() {
  return <div aria-hidden className="my-[0.28em] border-b border-dashed border-black" />;
}

export function Line({
  name,
  className = "",
  grow = true,
  maxLength,
  inputMode,
  testId,
}: {
  name: string;
  className?: string;
  grow?: boolean;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  testId?: string;
}) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  return (
    <input
      id={id}
      type="text"
      size={1}
      autoComplete="off"
      spellCheck={false}
      data-testid={testId}
      maxLength={maxLength}
      inputMode={inputMode}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className={`min-w-0 border-0 border-b border-black bg-transparent px-[0.15em] font-normal text-black outline-none ${grow ? "flex-1" : ""} ${className}`}
    />
  );
}

/** Dashed specify line that sits on the same row as an Other checkbox. */
export function Specify({ name }: { name: string }) {
  return <Line name={name} grow={false} className="ua-specify" />;
}

export interface ChoiceOption {
  value: string;
  label: string;
}

function labeled(uk: boolean, choices: readonly { value: string; uk: string }[]): ChoiceOption[] {
  return choices.map((choice) => ({ value: choice.value, label: uk ? choice.uk : choice.value }));
}

/** AVPU, pain, and route lists. Values stay the PDF strings in either language. */
export function useCardChoices(): { avpu: ChoiceOption[]; pain: ChoiceOption[]; route: ChoiceOption[] } {
  const uk = useLocale() === "uk";
  return {
    avpu: labeled(uk, AVPU_CHOICES),
    pain: labeled(uk, PAIN_CHOICES),
    route: ROUTE_OPTIONS.map((value) => ({ value, label: value })),
  };
}

/** Blank cell in a bordered grid. `size={1}` keeps the column from growing to the text. */
export function Cell({ name }: { name: string }) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  return (
    <input
      id={id}
      type="text"
      size={1}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="w-full min-w-0 bg-transparent px-[0.1em] text-center font-normal text-black outline-none"
    />
  );
}

/** Native list with the arrow hidden, so the cell still reads as a blank on the grid. */
export function Pick({ name, options }: { name: string; options: readonly ChoiceOption[] }) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  const known = options.some((option) => option.value === value);
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="ua-select"
    >
      <option value=""> </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {value && !known ? <option value={value}>{value}</option> : null}
    </select>
  );
}

export function Area({ name, className = "" }: { name: string; className?: string }) {
  const id = useFieldId(name);
  const [value, setValue] = useTextValue(name);
  return (
    <textarea
      id={id}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className={`w-full resize-none border-0 bg-transparent font-normal text-black outline-none ${className}`}
    />
  );
}

export function Mark({ name, children }: { name: string; children?: ReactNode }) {
  const id = useFieldId(name);
  const [checked, setChecked] = useChecked(name);
  return (
    <label htmlFor={id} className="inline-flex items-center gap-[0.28em] font-bold">
      <input
        id={id}
        type="checkbox"
        className="ua-box"
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
      />
      {children}
    </label>
  );
}

/** Square box from a set that can be cleared, same behavior as the paper card. */
export function Choice({
  name,
  group,
  members,
  children,
}: {
  name: string;
  group: string;
  members: readonly string[];
  children: ReactNode;
}) {
  const id = useFieldId(name);
  const groupName = useFieldId(group);
  const [checked, setChecked] = useExclusive(name, members);
  return (
    <label htmlFor={id} className="inline-flex items-center gap-[0.28em] font-bold">
      <input
        id={id}
        type="radio"
        name={groupName}
        className="ua-box"
        checked={checked}
        onChange={() => setChecked(true)}
        onClick={() => {
          if (checked) setChecked(false);
        }}
      />
      {children}
    </label>
  );
}
