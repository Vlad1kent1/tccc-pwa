"use client";

import Link from "next/link";
import { useT } from "@/i18n/use-t";
import type { SyncStatus } from "@/lib/db/types";

const tone: Record<SyncStatus, string> = {
  pending: "text-warning",
  synced: "text-muted",
  conflict: "bg-urgent text-on-urgent",
};

export function SyncBadge({ status }: { status: SyncStatus }) {
  const { t } = useT();
  const className = `inline-flex min-h-12 items-center rounded-md px-3 text-sm font-medium ${tone[status]}`;
  const label = t(`syncStatus.${status}`);

  if (status === "conflict") {
    return (
      <Link href="/settings#conflicts" className={className} data-sync={status}>
        {label}
      </Link>
    );
  }

  return (
    <span className={className} data-sync={status}>
      {label}
    </span>
  );
}
