"use client";

import { memo } from "react";
import { EvacPriority } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { Block } from "@/components/pages/casualties/board/block";
import { TextField } from "@/components/pages/casualties/board/text-field";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

const EVAC = [
  [EvacPriority.URGENT, "block1.urgent", "border-urgent bg-urgent text-on-urgent"],
  [EvacPriority.PRIORITY, "block1.priority", "border-priority bg-priority text-on-priority"],
  [EvacPriority.ROUTINE, "block1.routine", "border-routine bg-routine text-on-routine"],
] as const;

export const IdentificationBlock = memo(function IdentificationBlock() {
  const board = useBoard();
  const { t } = useT();
  const battleRosterNumber = useSlice((state) => state.identity.battleRosterNumber);
  const evacPriority = useSlice((state) => state.identity.evacPriority);

  return (
    <Block title={t("block1.title")}>
      <TextField
        label={t("block1.battleRoster")}
        placeholder={t("block1.battleRosterPlaceholder")}
        maxLength={20}
        value={battleRosterNumber ?? ""}
        onChange={(value) => board.editIdentity({ battleRosterNumber: rosterValue(value) })}
        onBlur={() => board.flush()}
      />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("block1.evacuation")}</span>
        <div role="radiogroup" aria-label={t("block1.evacuation")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {EVAC.map(([item, label, selected]) => {
            const on = evacPriority === item;
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={on}
                className={`min-h-16 rounded-xl border-2 px-3 text-base font-semibold ${on ? selected : "border-border bg-background"}`}
                onClick={() => board.editIdentity({ evacPriority: on ? null : item }, "now")}
              >
                {t(label)}
              </button>
            );
          })}
        </div>
      </div>
    </Block>
  );
});

function rosterValue(value: string): string | null {
  const cleaned = value.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 20);
  return cleaned || null;
}
