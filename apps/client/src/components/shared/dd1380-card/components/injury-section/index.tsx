"use client";

import Image from "next/image";
import { createContext, memo, useContext, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { BodyView, type BodyView as BodyViewName } from "@tccc/shared";
import { useCardCopy, useChecked, useFieldFocus, useFieldId } from "@/components/shared/dd1380-card/workflow";
import { useT } from "@/i18n/use-t";
import { ANTERIOR_SITES, POSTERIOR_SITES, figureMarkStyle, isPaperSite, type InjurySite, type StoredMark } from "@tccc/dd1380";
import { FigureMark, bodyBack, bodyFront } from "@/components/shared/figure-mark";
import { DropHeading, Line } from "../ua-fields";

const MarksContext = createContext<readonly StoredMark[]>([]);

export function InjuryMarksProvider({ marks, children }: { marks: readonly StoredMark[]; children: ReactNode }) {
  return <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>;
}

/** PDF rectangle of each figure, used to place the X targets on the drawing. */
const FRONT_BOX = [120.6, 231.85, 221.4, 458.65] as const;
const BACK_BOX = [295.2, 231.85, 396.0, 458.65] as const;

/**
 * The heaviest part of the card: two figures and ~160 targets. Memoized down to
 * each target, which re-renders only when its own box is checked or cleared.
 */
export const InjurySection = memo(function InjurySection() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.injury} className="flex min-h-0 flex-1 flex-col print:h-auto print:flex-none">
      <DropHeading cap={copy.injuryCap} rest={copy.injuryRest} note={copy.injuryNote} />
      <div className="mt-[0.35em] grid grid-cols-2 gap-x-[0.55em]">
        <LimbColumn
          arm={copy.rArm}
          armField="r_arm"
          leg={copy.rLeg}
          legField="r_leg"
          image={bodyFront}
          box={FRONT_BOX}
          sites={ANTERIOR_SITES}
          label={copy.anterior}
          view={BodyView.FRONT}
        />
        <LimbColumn
          arm={copy.lArm}
          armField="l_arm"
          leg={copy.lLeg}
          legField="l_leg"
          image={bodyBack}
          box={BACK_BOX}
          sites={POSTERIOR_SITES}
          label={copy.posterior}
          view={BodyView.BACK}
        />
      </div>
    </section>
  );
});

const LimbColumn = memo(function LimbColumn({
  arm,
  armField,
  leg,
  legField,
  image,
  box,
  sites,
  label,
  view,
}: {
  arm: string;
  armField: string;
  leg: string;
  legField: string;
  image: typeof bodyFront;
  box: readonly [number, number, number, number];
  sites: readonly InjurySite[];
  label: string;
  view: BodyViewName;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] items-stretch gap-[0.35em]">
      <div className="flex flex-col justify-between gap-[0.45em] py-[4%]">
        <Tourniquet limb={arm} field={armField} />
        <Tourniquet limb={leg} field={legField} />
      </div>
      <Figure label={label} image={image} box={box} sites={sites} view={view} />
    </div>
  );
});

const Tourniquet = memo(function Tourniquet({ limb, field }: { limb: string; field: string }) {
  const copy = useCardCopy();
  const { t } = useT();
  const typeBox = useFieldFocus(`${field}_type`);
  // A blank type is not a removal: the type from focus comes back on blur, with this hint (P0-002).
  const [removeHint, setRemoveHint] = useState(false);
  return (
    <div className="border border-black px-[0.4em] py-[0.35em] leading-tight">
      <div className="font-bold">
        {copy.tq} {limb}
      </div>
      <div className="mt-[0.28em] flex items-end gap-[0.25em]">
        <span className="font-bold">{copy.type}</span>
        <Line name={`${field}_type`} onFocus={typeBox.focus} onBlur={() => setRemoveHint(typeBox.blur())} />
      </div>
      {removeHint ? (
        <p role="status" className="mt-[0.18em] text-[0.85em] font-normal italic print:hidden">
          {t("block4.removeHint")}
        </p>
      ) : null}
      <div className="mt-[0.18em] flex items-end gap-[0.25em]">
        <span className="font-bold">{copy.tqTime}</span>
        <Line name={`${field}_time`} />
      </div>
    </div>
  );
});

const Figure = memo(function Figure({
  label,
  image,
  box,
  sites,
  view,
}: {
  label: string;
  image: typeof bodyFront;
  box: readonly [number, number, number, number];
  sites: readonly InjurySite[];
  view: BodyViewName;
}) {
  const all = useContext(MarksContext);
  const marks = useMemo(
    () => all.filter((mark) => mark.view === view && mark.x != null && mark.y != null && !isPaperSite(mark.siteCode)),
    [all, view],
  );
  return (
    <div role="group" aria-label={label} className="relative">
      <Image src={image} alt="" unoptimized draggable={false} className="pointer-events-none h-auto w-full select-none" />
      {sites.map((site) => (
        <Hit key={site.id} site={site} box={box} />
      ))}
      {marks.map((mark) => (
        <FigureMark key={mark.id} x={mark.x} y={mark.y} className="size-[1.5em] text-[1.15em] text-black" />
      ))}
    </div>
  );
});

const Hit = memo(function Hit({
  site,
  box,
}: {
  site: InjurySite;
  box: readonly [number, number, number, number];
}) {
  const id = useFieldId(site.id);
  const [checked, setChecked] = useChecked(site.id);
  const [x0, y0, x1, y1] = box;
  const width = x1 - x0;
  const height = y1 - y0;
  const style: CSSProperties = {
    ...figureMarkStyle((site.x - x0) / width, (site.y - y0) / height),
    width: `${(site.size / width) * 100}%`,
    height: `${(site.size / height) * 100}%`,
  };
  return (
    <input
      id={id}
      type="checkbox"
      title={site.label}
      className="dd-mark absolute"
      style={style}
      checked={checked}
      onChange={(event) => setChecked(event.target.checked)}
    />
  );
});
