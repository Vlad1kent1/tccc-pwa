"use client";

import type { EvacPriority } from "@tccc/shared";
import { useT } from "@/i18n/use-t";

const tone: Record<EvacPriority, string> = {
  URGENT: "bg-urgent text-on-urgent",
  PRIORITY: "bg-priority text-on-priority",
  ROUTINE: "bg-routine text-on-routine",
};

export function PriorityBadge({ priority }: { priority: EvacPriority | null }) {
  const { enumLabel } = useT();
  if (!priority) return null;

  return (
    <span
      data-priority={priority}
      className={`inline-flex min-h-8 items-center rounded-lg px-2 text-sm font-semibold ${tone[priority]}`}
    >
      {enumLabel("EvacPriority", priority)}
    </span>
  );
}
