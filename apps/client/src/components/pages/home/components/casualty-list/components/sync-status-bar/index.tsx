"use client";

import { useT } from "@/i18n/use-t";
import { useSyncStatus } from "@/lib/sync";

export function SyncStatusBar({ count }: { count: number }) {
  const status = useSyncStatus();
  const { t } = useT();
  const lastSync = status.lastSyncAt
    ? t("list.lastSync", { time: new Date(status.lastSyncAt).toLocaleString() })
    : t("list.neverSynced");

  return (
    <p role="status" className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <span>{t("list.count", { count })}</span>
      <span>{t("list.pending", { count: status.pendingCount })}</span>
      {status.conflictCount > 0 ? <span>{t("list.conflicts", { count: status.conflictCount })}</span> : null}
      {status.state === "degraded" && status.pendingCount > 0 ? (
        <span className="text-warning" title={status.lastError?.message}>
          {t("connectivity.stuck")}
        </span>
      ) : null}
      <span>{lastSync}</span>
    </p>
  );
}
