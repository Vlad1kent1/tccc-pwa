"use client";

import Image from "next/image";
import { memo, useState } from "react";
import { BodyView, type BodyRegion, type BodyView as BodyViewName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import bodyBack from "@/components/pages/casualties/dd1380/assets/body-back.png";
import bodyFront from "@/components/pages/casualties/dd1380/assets/body-front.png";
import { regionFor } from "@/components/pages/casualties/dd1380/mapping";
import { BACK_HITS, FRONT_HITS } from "@/components/pages/casualties/board/regions";
import { SiteDrawer } from "@/components/pages/casualties/board/site-drawer";
import { useSlice } from "@/components/pages/casualties/board/store";

export const Mannequin = memo(function Mannequin() {
  const { t, enumLabel } = useT();
  const injuries = useSlice((state) => state.injuries);
  const [view, setView] = useState<BodyViewName>(BodyView.FRONT);
  const [region, setRegion] = useState<BodyRegion | null>(null);
  const hits = view === BodyView.FRONT ? FRONT_HITS : BACK_HITS;
  const marked = new Set(injuries.filter((row) => row.view === view && row.description).map((row) => regionFor(row.description!)));

  return (
    <section aria-label={t("wizard.bodyDiagram")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("wizard.sections.B")}</h2>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={view === BodyView.FRONT} className={view === BodyView.FRONT ? "chip chip-on" : "chip"} onClick={() => setView(BodyView.FRONT)}>
            {t("wizard.viewFront")}
          </button>
          <button type="button" aria-pressed={view === BodyView.BACK} className={view === BodyView.BACK ? "chip chip-on" : "chip"} onClick={() => setView(BodyView.BACK)}>
            {t("wizard.viewBack")}
          </button>
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-sm">
        <Image src={view === BodyView.FRONT ? bodyFront : bodyBack} alt="" className="h-auto w-full" priority />
        {hits.map((hit) => (
          <button
            key={hit.region}
            type="button"
            className={marked.has(hit.region) ? "absolute rounded-xl border-2 border-red-600 bg-red-600/25" : "absolute rounded-xl border-2 border-transparent bg-transparent"}
            style={{ left: `${hit.left}%`, top: `${hit.top}%`, width: `${hit.width}%`, height: `${hit.height}%` }}
            aria-label={enumLabel("BodyRegion", hit.region)}
            onClick={() => setRegion(hit.region)}
          />
        ))}
      </div>
      {region ? <SiteDrawer region={region} view={view} onClose={() => setRegion(null)} /> : null}
    </section>
  );
});
