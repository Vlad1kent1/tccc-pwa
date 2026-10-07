"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/use-t";

let denied = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPersistenceDenied(value: boolean): void {
  denied = value;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function PersistenceBanner() {
  const show = useSyncExternalStore(subscribe, () => denied, () => false);
  const { t } = useT();
  if (!show) return null;

  return (
    <div data-print-hide role="status" className="banner-warning">
      <p className="text-sm">{t("storage.denied")}</p>
      <button
        type="button"
        className="btn btn-secondary shrink-0"
        onClick={() => setPersistenceDenied(false)}
      >
        {t("storage.dismiss")}
      </button>
    </div>
  );
}
