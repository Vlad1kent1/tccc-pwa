"use client";

import { useCardCopy } from "@/components/shared/dd1380-card/workflow";
import { DropHeading, Line, Mark, Specify } from "../../../ua-fields";

export function Treatments() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.treatments}>
      <div className="grid grid-cols-[minmax(0,1fr)_8.2em] items-end gap-x-[0.35em]">
        <DropHeading cap={copy.treatmentsCap} rest={copy.treatmentsRest} note={copy.treatmentsNote} />
        <span className="text-center font-bold italic">{copy.typeCol}</span>
      </div>

      <div className="mt-[0.22em] grid grid-cols-[auto_minmax(0,1fr)_8.2em] items-center gap-x-[0.4em] gap-y-[0.16em]">
        <span className="font-bold">C:</span>
        <div className="flex flex-wrap items-center gap-x-[0.5em] gap-y-[0.1em]">
          <span className="font-bold">{copy.tqDash}</span>
          <Mark name="treatment_C_TQ_Extremity">{copy.extremity}</Mark>
          <Mark name="treatment_C_TQ_Junctional">{copy.junctional}</Mark>
          <Mark name="treatment_C_TQ_Truncal">{copy.truncal}</Mark>
        </div>
        <Line name="treatment_C_TQ_type" grow={false} className="w-full" />

        <span />
        <div className="flex flex-wrap items-center gap-x-[0.5em] gap-y-[0.1em]">
          <span className="font-bold">{copy.dressingDash}</span>
          <Mark name="treatment_C_Dressing_Hemostatic">{copy.hemostatic}</Mark>
          <Mark name="treatment_C_Dressing_Pressure">{copy.pressure}</Mark>
          <span className="inline-flex items-end">
            <Mark name="treatment_C_Dressing_Other">{copy.dressingOther}</Mark>
            <Specify name="treatment_C_Dressing_other_specify" />
          </span>
        </div>
        <Line name="treatment_C_Dressing_type" grow={false} className="w-full" />

        <span className="self-start font-bold">A:</span>
        <div className="self-start">
          <div className="flex flex-wrap items-center gap-x-[0.5em] gap-y-[0.1em]">
            <Mark name="treatment_A_Intact">{copy.intact}</Mark>
            <Mark name="treatment_A_NPA">{copy.npa}</Mark>
            <Mark name="treatment_A_CRIC">{copy.cric}</Mark>
            <Mark name="treatment_A_ET-Tube">{copy.etTube}</Mark>
            <Mark name="treatment_A_SGA">{copy.sga}</Mark>
          </div>
        </div>
        <Line name="treatment_A_type" grow={false} className="w-full self-start" />

        <span className="font-bold">B:</span>
        <div className="flex flex-wrap items-center gap-x-[0.5em] gap-y-[0.1em]">
          <Mark name="treatment_B_O2">{copy.o2tx}</Mark>
          <Mark name="treatment_B_NeedleD">{copy.needle}</Mark>
          <Mark name="treatment_B_Chest-Tube">{copy.chestTube}</Mark>
          <Mark name="treatment_B_ChestSeal">{copy.chestSeal}</Mark>
        </div>
        <Line name="treatment_B_type" grow={false} className="w-full" />
      </div>
    </section>
  );
}
