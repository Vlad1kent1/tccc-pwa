"use client";

import { useT } from "@/i18n/use-t";

export function NowButton({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  return (
    <button type="button" className="btn btn-secondary h-12 min-h-12 shrink-0 px-2.5" onClick={onClick}>
      <ClockIcon />
      <span>{t("actions.now")}</span>
    </button>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
      <path d="M18 4l2 2" />
    </svg>
  );
}
