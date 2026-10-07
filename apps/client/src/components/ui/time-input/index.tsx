"use client";

import { useT } from "@/i18n/use-t";
import { isoToLocalInput, localInputToIso } from "@/lib/forms/time";
import { fieldClass } from "@/components/ui/field";

export function TimeInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  error?: string;
}) {
  const { t } = useT();

  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex gap-2">
        <input
          type="datetime-local"
          className={fieldClass}
          value={isoToLocalInput(value)}
          onChange={(event) => onChange(localInputToIso(event.target.value))}
        />
        <button
          type="button"
          onClick={() => onChange(new Date().toISOString())}
          className="btn btn-primary shrink-0"
        >
          {t("wizard.now")}
        </button>
      </span>
      {error ? <span className="error-text">{error}</span> : null}
    </label>
  );
}
