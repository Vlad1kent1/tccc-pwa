"use client";

import type { ENUMS } from "@tccc/shared";
import { useT } from "@/i18n/use-t";

type EnumName = keyof typeof ENUMS;

type MultiProps<T extends string> = {
  mode?: "multiple";
  value: readonly T[];
  onChange: (next: T[]) => void;
};

type SingleProps<T extends string> = {
  mode: "single";
  value: T | null;
  onChange: (next: T | null) => void;
};

type Props<T extends string> = {
  label: string;
  enumName: EnumName;
  options: readonly T[];
  error?: string;
} & (MultiProps<T> | SingleProps<T>);

export function EnumChips<T extends string>(props: Props<T>) {
  const { enumLabel } = useT();
  const { label, enumName, options, error } = props;

  function pressed(option: T): boolean {
    return props.mode === "single" ? props.value === option : props.value.includes(option);
  }

  function toggle(option: T): void {
    if (props.mode === "single") {
      props.onChange(props.value === option ? null : option);
      return;
    }
    const selected = new Set(props.value);
    if (selected.has(option)) selected.delete(option);
    else selected.add(option);
    props.onChange(options.filter((item) => selected.has(item)));
  }

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={pressed(option)}
            onClick={() => toggle(option)}
            className={pressed(option) ? "chip chip-on" : "chip"}
          >
            {enumLabel(enumName, option)}
          </button>
        ))}
      </div>
      {error ? <span className="error-text">{error}</span> : null}
    </div>
  );
}
