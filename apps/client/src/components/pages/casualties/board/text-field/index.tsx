"use client";

import { useId } from "react";
import { fieldClass } from "@/components/ui/field";

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  onFocus,
  placeholder,
  maxLength,
  inputMode,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal";
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <input
        id={id}
        data-testid={testId}
        className={`${fieldClass} min-h-12`}
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </div>
  );
}
