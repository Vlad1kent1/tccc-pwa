"use client";

import { connectivityMode, useSyncStatus } from "@/lib/sync";
import { useT } from "@/i18n/use-t";

export function ConnectivityIndicator() {
  const status = useSyncStatus();
  const { t } = useT();
  const mode = connectivityMode(status);
  const label = t(`connectivity.${mode}`);

  return (
    <p
      role="status"
      data-connectivity={mode}
      title={status.lastError?.message}
      className="flex min-h-12 items-center gap-2 text-sm font-medium"
    >
      <span
        aria-hidden
        className={`size-3 rounded-full ${
          mode === "online" ? "bg-accent" : mode === "offline" ? "bg-urgent" : "bg-warning"
        }`}
      />
      <span>{label}</span>
    </p>
  );
}
