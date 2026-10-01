"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/i18n/use-t";
import { useSyncStatus } from "@/lib/sync";
import { dismissToast, showToast, useToasts } from "./toast-store";

export function ToastViewport() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div data-print-hide className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4" style={{ bottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto row flex min-h-12 w-full max-w-md items-center justify-between gap-3 px-4 text-sm shadow-lg"
        >
          <p>{toast.message}</p>
          <button
            type="button"
            className="btn btn-icon shrink-0 text-xl"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Announces a completed sync that started while the device was offline. */
export function SyncToast() {
  const status = useSyncStatus();
  const { t } = useT();
  const previous = useRef(status);

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    const finished =
      before.connectivity === "offline" &&
      status.lastSyncAt != null &&
      status.lastSyncAt !== before.lastSyncAt &&
      status.connectivity !== "offline" &&
      status.state !== "syncing";
    if (!finished) return;
    const synced = Math.max(0, before.pendingCount - status.pendingCount);
    if (synced > 0) showToast(t("toast.synced", { count: synced }));
  }, [status, t]);

  return null;
}
