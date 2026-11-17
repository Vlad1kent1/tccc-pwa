"use client";

import { useId } from "react";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";

export function OptionSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const { t } = useT();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select id={id} className={`${fieldClass} min-h-12`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("actions.unset")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
