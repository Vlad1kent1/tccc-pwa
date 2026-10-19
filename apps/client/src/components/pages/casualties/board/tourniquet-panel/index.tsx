"use client";

import { memo, useEffect, useRef, useState } from "react";
import { BodyRegion, Limb } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { formatHmm, lastTimeToken, timeTokenToIso } from "@/lib/forms/time";
import { fieldClass } from "@/components/ui/field";
import { StampField } from "@/components/pages/casualties/board/stamp-field";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

const LIMBS = [
  [Limb.RIGHT_ARM, BodyRegion.RIGHT_ARM, "block4.rightArm"],
  [Limb.LEFT_ARM, BodyRegion.LEFT_ARM, "block4.leftArm"],
  [Limb.RIGHT_LEG, BodyRegion.RIGHT_LEG, "block4.rightLeg"],
  [Limb.LEFT_LEG, BodyRegion.LEFT_LEG, "block4.leftLeg"],
] as const;

export const TourniquetPanel = memo(function TourniquetPanel() {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3 xl:w-80">
      <h3 className="text-base font-semibold">{t("block4.tourniquets")}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
        {LIMBS.map(([limb, region, label]) => (
          <TourniquetCard key={limb} limb={limb} region={region} label={t(label)} />
        ))}
      </div>
    </div>
  );
});

function TourniquetCard({ limb, region, label }: { limb: Limb; region: BodyRegion; label: string }) {
  const board = useBoard();
  const { t } = useT();
  const row = useSlice((state) => state.tourniquets.find((item) => item.limb === limb));
  const injuredAt = useSlice((state) => state.identity.injuredAt);
  const [timeText, setTimeText] = useState("");
  const timeLock = useRef(false);
  const canonical = row ? formatHmm(row.appliedAt) : "";

  useEffect(() => {
    setTimeText((current) => {
      if (!row) return timeLock.current ? current : "";
      if (timeLock.current || lastTimeToken(current) === canonical) return current || canonical;
      return canonical;
    });
  }, [canonical, row]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <h4 className="font-semibold">{label}</h4>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("block4.type")}</span>
        <input
          className={`${fieldClass} min-h-12`}
          maxLength={50}
          autoComplete="off"
          placeholder={t("block4.typePlaceholder")}
          value={row?.type ?? ""}
          onChange={(event) => {
            const iso = timeTokenToIso(lastTimeToken(timeText), { near: row?.appliedAt, notBefore: injuredAt });
            board.setTourniquet(region, event.target.value, iso ?? undefined);
          }}
          onBlur={() => board.flush()}
        />
      </label>
      <StampField
        label={t("block4.time")}
        value={timeText}
        onChange={(next) => {
          const typed = (row?.type ?? "").trim();
          timeLock.current = true;
          setTimeText(next);
          const iso = timeTokenToIso(lastTimeToken(next), { near: row?.appliedAt, notBefore: injuredAt });
          if (!iso || !typed) return;
          board.setTourniquetTime(region, iso);
        }}
        onBlur={() => board.flush()}
      />
    </div>
  );
}
