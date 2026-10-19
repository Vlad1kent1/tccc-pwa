"use client";

import { memo } from "react";
import { Block } from "@/components/pages/casualties/board/block";
import { Mannequin } from "@/components/pages/casualties/board/mannequin";
import { TourniquetPanel } from "@/components/pages/casualties/board/tourniquet-panel";
import { useT } from "@/i18n/use-t";

export const InjuryBlock = memo(function InjuryBlock() {
  const { t } = useT();
  return (
    <Block title={t("block4.title")} note={t("block4.note")}>
      <div className="flex flex-col gap-4 xl:flex-row">
        <Mannequin />
        <TourniquetPanel />
      </div>
    </Block>
  );
});
