"use client";

import { memo } from "react";
import { MechanismOfInjury } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { Block } from "@/components/pages/casualties/board/block";
import { CheckOption } from "@/components/pages/casualties/board/check-option";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

const ITEMS = [
  [MechanismOfInjury.ARTILLERY, "block3.artillery"],
  [MechanismOfInjury.BLUNT, "block3.blunt"],
  [MechanismOfInjury.BURN, "block3.burn"],
  [MechanismOfInjury.FALL, "block3.fall"],
  [MechanismOfInjury.GRENADE, "block3.grenade"],
  [MechanismOfInjury.GSW, "block3.gsw"],
  [MechanismOfInjury.IED, "block3.ied"],
  [MechanismOfInjury.LANDMINE, "block3.landmine"],
  [MechanismOfInjury.MVC, "block3.mvc"],
  [MechanismOfInjury.RPG, "block3.rpg"],
  [MechanismOfInjury.OTHER, "block3.otherItem"],
] as const;

export const MechanismBlock = memo(function MechanismBlock() {
  const board = useBoard();
  const { t } = useT();
  const mechanisms = useSlice((state) => state.mechanism.mechanisms);
  const mechanismOther = useSlice((state) => state.mechanism.mechanismOther);
  const other = mechanisms.includes(MechanismOfInjury.OTHER);

  return (
    <Block title={t("block3.title")} note={t("block3.note")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {ITEMS.map(([item, label]) => (
          <CheckOption key={item} label={t(label)} checked={mechanisms.includes(item)} onChange={() => board.toggleMechanism(item)} />
        ))}
      </div>
      {other ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("block3.other")}</span>
          <input
            className={`${fieldClass} min-h-12`}
            maxLength={200}
            value={mechanismOther ?? ""}
            onChange={(event) => board.editMechanism({ mechanismOther: event.target.value || null }, "debounce")}
            onBlur={() => board.flush()}
          />
        </label>
      ) : null}
    </Block>
  );
});
