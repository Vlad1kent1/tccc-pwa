"use client";

import { useCallback, useEffect, useState } from "react";
import { setPersistenceDenied } from "@/components/persistence-banner";
import { getStorageStatus, requestPersistentStorage, type StorageStatus } from "@/lib/db";

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function StorageStatusPanel() {
  const [status, setStatus] = useState<StorageStatus | null>(null);

  const refresh = useCallback(() => {
    getStorageStatus().then(setStatus, () => setStatus({ persisted: false, usage: null, quota: null }));
  }, []);

  const requestPersistence = useCallback(() => {
    requestPersistentStorage()
      .then((granted) => {
        if (!granted) {
          console.warn("Persistent storage was not granted");
          setPersistenceDenied(true);
        } else {
          setPersistenceDenied(false);
        }
        refresh();
      })
      .catch((error: unknown) => {
        console.warn("Persistent storage request failed", error);
        setPersistenceDenied(true);
      });
  }, [refresh]);

  useEffect(refresh, [refresh]);

  const percent =
    status?.usage != null && status.quota ? Math.min(100, (status.usage / status.quota) * 100) : null;

  return (
    <section aria-labelledby="storage-heading" className="surface flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="storage-heading" className="text-lg font-medium">
          Local storage
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={requestPersistence}
            className="btn btn-secondary"
          >
            Keep data on this device
          </button>
          <button
            type="button"
            onClick={refresh}
            className="btn btn-secondary"
          >
            Refresh
          </button>
        </div>
      </div>

      {status == null ? (
        <p className="text-sm opacity-70">Checking storage…</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="opacity-70">Used</dt>
            <dd>{formatBytes(status.usage)}</dd>
            <dt className="opacity-70">Quota</dt>
            <dd>{formatBytes(status.quota)}</dd>
            <dt className="opacity-70">Persistent storage</dt>
            <dd>{status.persisted ? "Granted" : "Not granted: the browser may evict data under storage pressure"}</dd>
          </dl>
          {percent != null && (
            <div
              role="progressbar"
              aria-label="Storage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
              className="h-2 w-full overflow-hidden rounded-full bg-border"
            >
              <div className="h-full bg-accent" style={{ width: `${Math.max(percent, 1)}%` }} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
