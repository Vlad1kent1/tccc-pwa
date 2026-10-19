"use client";

import { useId } from "react";
import { useT } from "@/i18n/use-t";
import { applyNowStamp, maskHmm } from "@/lib/forms/time";
import { fieldClass } from "@/components/ui/field";
import { NowButton } from "@/components/pages/casualties/board/now-button";

export function StampField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const { t } = useT();
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className={`${fieldClass} min-h-12`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder={t("actions.timeHint")}
          value={value}
          onChange={(event) => onChange(maskHmm(event.target.value))}
          onBlur={onBlur}
        />
        <NowButton onClick={() => onChange(applyNowStamp())} />
      </div>
    </div>
  );
}
