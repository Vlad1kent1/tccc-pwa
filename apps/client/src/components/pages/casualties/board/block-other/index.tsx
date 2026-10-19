"use client";

import { memo } from "react";
import { OtherTreatment } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { Block } from "@/components/pages/casualties/board/block";
import { CheckOption } from "@/components/pages/casualties/board/check-option";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const OtherBlock = memo(function OtherBlock() {
  const board = useBoard();
  const { t } = useT();
  const pill = useSlice((state) => state.treatments.combatPillPack);
  const eyeRight = useSlice((state) => state.treatments.eyeShieldRight);
  const eyeLeft = useSlice((state) => state.treatments.eyeShieldLeft);
  const hypothermiaType = useSlice((state) => state.treatments.hypothermiaType);
  const splint = useSlice((state) => state.treatments.otherTreatments.includes(OtherTreatment.SPLINT));
  const hypothermia = useSlice((state) => state.treatments.otherTreatments.includes(OtherTreatment.HYPOTHERMIA_PREVENTION));

  return (
    <Block title={t("block9.title")}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CheckOption label={t("block9.combatPillPack")} checked={pill} onChange={(checked) => board.editTreatments({ combatPillPack: checked })} />
        <CheckOption
          label={`${t("block9.eyeShield")} (${t("block9.eyeRight")})`}
          checked={eyeRight}
          onChange={(checked) => board.editTreatments({ eyeShieldRight: checked })}
        />
        <CheckOption
          label={`${t("block9.eyeShield")} (${t("block9.eyeLeft")})`}
          checked={eyeLeft}
          onChange={(checked) => board.editTreatments({ eyeShieldLeft: checked })}
        />
        <CheckOption label={t("block9.splint")} checked={splint} onChange={() => board.toggleTreatment("otherTreatments", OtherTreatment.SPLINT)} />
        <CheckOption
          label={t("block9.hypothermia")}
          checked={hypothermia}
          onChange={() => board.toggleTreatment("otherTreatments", OtherTreatment.HYPOTHERMIA_PREVENTION)}
        />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("block9.type")}</span>
        <input
          className={`${fieldClass} min-h-12`}
          maxLength={100}
          autoComplete="off"
          placeholder={t("block9.typePlaceholder")}
          value={hypothermiaType ?? ""}
          onBlur={() => board.flush()}
          onChange={(event) => {
            const value = event.target.value.slice(0, 100);
            board.editTreatments({ hypothermiaType: value || null }, "debounce");
            if (value.trim() && !hypothermia) board.toggleTreatment("otherTreatments", OtherTreatment.HYPOTHERMIA_PREVENTION);
          }}
        />
      </label>
    </Block>
  );
});
