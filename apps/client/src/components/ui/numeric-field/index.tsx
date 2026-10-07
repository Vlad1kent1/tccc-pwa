"use client";

import { fieldClass } from "@/components/ui/field";

export function NumericField({
  label,
  value,
  onChange,
  error,
  autoFocus = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <input
        inputMode="numeric"
        autoFocus={autoFocus}
        className={`${fieldClass} min-h-14 text-2xl`}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "") onChange(null);
          else if (/^\d+$/.test(raw)) onChange(Number(raw));
        }}
      />
      {error ? <span className="error-text">{error}</span> : null}
    </label>
  );
}
