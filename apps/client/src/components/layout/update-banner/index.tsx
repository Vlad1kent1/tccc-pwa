"use client";

import { useSerwist } from "@serwist/turbopack/react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t";

export function UpdateBanner() {
  const { serwist } = useSerwist();
  const { t } = useT();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!serwist) return;

    const onWaiting = () => setWaiting(true);
    serwist.addEventListener("waiting", onWaiting);

    return () => {
      serwist.removeEventListener("waiting", onWaiting);
    };
  }, [serwist]);

  if (!waiting) return null;

  return (
    <div
      data-print-hide
      role="status"
      className="banner-warning"
    >
      <p className="text-sm font-medium">{t("update.available")}</p>
      <button
        type="button"
        className="btn btn-primary shrink-0"
        onClick={() => {
          serwist?.addEventListener("controlling", () => {
            window.location.reload();
          });
          serwist?.messageSkipWaiting();
        }}
      >
        {t("update.reload")}
      </button>
    </div>
  );
}
