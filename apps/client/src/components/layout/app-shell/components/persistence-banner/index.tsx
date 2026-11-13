"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/use-t";
import { isPersistenceDenied, setPersistenceDenied, subscribePersistenceDenied } from "@/lib/persistence-denied";

export function PersistenceBanner() {
  const show = useSyncExternalStore(subscribePersistenceDenied, isPersistenceDenied, () => false);
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
