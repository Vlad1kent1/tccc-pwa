"use client";

import Image from "next/image";
import { memo, type MouseEvent } from "react";
import { BodyView, type BodyView as BodyViewName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import bodyBack from "@/components/pages/casualties/dd1380/assets/body-back.png";
import bodyFront from "@/components/pages/casualties/dd1380/assets/body-front.png";
import { figureMarkClass } from "@/components/pages/casualties/board/figure-mark";
import { figureMarkStyle } from "@/components/pages/casualties/board/regions";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";
import type { BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

export const Mannequin = memo(function Mannequin() {
  const { t } = useT();
  const injuries = useSlice((state) => state.injuries);

  return (
    <div className="flex flex-1 flex-col gap-4 md:flex-row">
      <Figure title={t("block4.front")} placeLabel={t("block4.placeMark")} removeLabel={t("block4.removeMark")} view={BodyView.FRONT} image={bodyFront} injuries={injuries} />
      <Figure title={t("block4.back")} placeLabel={t("block4.placeMark")} removeLabel={t("block4.removeMark")} view={BodyView.BACK} image={bodyBack} injuries={injuries} />
    </div>
  );
});

function Figure({
  title,
  placeLabel,
  removeLabel,
  view,
  image,
  injuries,
}: {
  title: string;
  placeLabel: string;
  removeLabel: string;
  view: BodyViewName;
  image: typeof bodyFront;
  injuries: BoardSnapshot["injuries"];
}) {
  const board = useBoard();
  const marks = injuries.filter((row) => row.view === view && row.x != null && row.y != null);

  function place(event: MouseEvent<HTMLButtonElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    board.placeInjury(view, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <p className="text-center text-sm font-semibold">{title}</p>
      <div className="relative mx-auto w-full max-w-xs">
        <Image src={image} alt="" className="pointer-events-none h-auto w-full select-none" priority={view === BodyView.FRONT} draggable={false} />
        <button type="button" aria-label={`${title}. ${placeLabel}`} className="absolute inset-0 cursor-crosshair bg-transparent" onClick={place} />
        {marks.map((mark) => (
          <button
            key={mark.id}
            type="button"
            aria-label={removeLabel}
            className={figureMarkClass("size-8 cursor-pointer text-xl text-danger-strong")}
            style={figureMarkStyle(mark.x ?? 0, mark.y ?? 0)}
            onClick={() => board.removeInjury(mark.id)}
          >
            X
          </button>
        ))}
      </div>
    </div>
  );
}
