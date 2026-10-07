"use client";

import { CirculationTreatment, type BodyRegion, type BodyView as BodyViewName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { flushBoard, limbForRegion, setTourniquet, toggleInjury, toggleTreatment, useSlice } from "@/components/pages/casualties/board/store";
import { siteLabel, sitesFor } from "@/components/pages/casualties/board/regions";

export function SiteDrawer({
  region,
  view,
  onClose,
}: {
  region: BodyRegion;
  view: BodyViewName;
  onClose: () => void;
}) {
  const { t, enumLabel } = useT();
  const injuries = useSlice((state) => state.injuries);
  const tourniquets = useSlice((state) => state.tourniquets);
  const treatments = useSlice((state) => state.treatments);
  const sites = sitesFor(region, view);
  const limb = limbForRegion(region);
  const tourniquet = limb ? tourniquets.find((row) => row.limb === limb) : undefined;
  const marked = new Set(injuries.map((row) => row.description));

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={enumLabel("BodyRegion", region)}
        className="flex max-h-[75vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-4 pb-8 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{enumLabel("BodyRegion", region)}</h2>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("wizard.done")}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("card.injuries")}</span>
          <div className="flex flex-wrap gap-2">
            {sites.map((site) => {
              const on = marked.has(site.id);
              return (
                <button key={site.id} type="button" aria-pressed={on} className={on ? "chip chip-on" : "chip"} onClick={() => toggleInjury(site, view, region)}>
                  {siteLabel(site.label)}
                </button>
              );
            })}
          </div>
        </div>
        {limb ? (
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">{t("card.tourniquets")}</span>
            <input
              className={`${fieldClass} min-h-14 text-lg`}
              value={tourniquet?.type ?? ""}
              placeholder="CAT"
              onChange={(event) => setTourniquet(region, event.target.value)}
              onBlur={() => flushBoard()}
            />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {([CirculationTreatment.HEMOSTATIC, CirculationTreatment.PRESSURE, CirculationTreatment.DRESSING] as const).map((item) => {
            const on = treatments.circulation.includes(item);
            return (
              <button key={item} type="button" aria-pressed={on} className={on ? "chip chip-on" : "chip"} onClick={() => toggleTreatment("circulation", item)}>
                {enumLabel("CirculationTreatment", item)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
