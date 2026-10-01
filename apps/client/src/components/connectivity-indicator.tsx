"use client";

import { useSyncStatus } from "@/lib/sync";
import { useT } from "@/i18n/use-t";

export function ConnectivityIndicator() {
  const status = useSyncStatus();
  const { t } = useT();

  const mode =
    status.state === "syncing"
      ? "syncing"
      : status.connectivity === "offline" || status.state === "offline"
        ? "offline"
        : status.connectivity === "degraded"
          ? "degraded"
          : "online";

  const label = t(`connectivity.${mode}`);
  const pending = status.pendingCount > 0 ? t("connectivity.pending", { count: status.pendingCount }) : null;

  return (
    <p
      role="status"
      data-connectivity={mode}
      className="flex min-h-12 items-center gap-2 text-sm font-medium"
    >
      <span
        aria-hidden
        className={`size-3 rounded-full ${
          mode === "online" ? "bg-accent" : mode === "syncing" ? "bg-warning" : "bg-urgent"
        }`}
      />
      <span>{label}</span>
    </p>
  );
}
