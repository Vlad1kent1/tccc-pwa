"use client";

import { memo } from "react";
import { useCardCopy } from "@/components/shared/dd1380-card/workflow";
import { RosterEvac } from "../roster-evac";
import { Area, Dash, DropHeading, Line, Mark, UaSheet } from "../ua-fields";
import { FluidsTable, MedsTable, Treatments } from "./components";

export const CardBack = memo(function CardBack() {
  const copy = useCardCopy();
  return (
    <UaSheet label={copy.sheetBack}>
      <div className="flex h-full min-h-0 flex-1 flex-col px-[0.45em] pt-[0.28em] pb-[0.35em] print:h-auto print:flex-none">
        <RosterEvac ruleAfterEvac />
        <Treatments />
        <FluidsTable />
        <MedsTable />
        <Other />
        <Dash />
        <Notes />
        <Dash />
        <FirstResponder />
      </div>
    </UaSheet>
  );
});

function Other() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.otherSection} className="mt-[0.4em] grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[0.4em] gap-y-[0.16em]">
      <span className="font-bold">{copy.otherLabel}</span>
      <Mark name="treatment_other_CombatPillPack">{copy.pillPack}</Mark>
      <span />
      <div className="flex flex-wrap items-center gap-x-[0.45em] gap-y-[0.1em]">
        <Mark name="treatment_other_EyeShield">{copy.eye}</Mark>
        <Mark name="treatment_other_R">{copy.eyeRight}</Mark>
        <Mark name="treatment_other_L">{copy.eyeLeft}</Mark>
        <span className="font-bold">{copy.eyeClose}</span>
        <Mark name="treatment_other_Splint">{copy.splint}</Mark>
      </div>
      <span />
      <div className="flex flex-wrap items-end gap-x-[0.55em]">
        <Mark name="treatment_other_HypothermiaPrevention">{copy.hypothermia}</Mark>
        <span className="font-bold">{copy.otherType}</span>
        <Line name="treatment_other_type" className="min-w-[8em]" />
      </div>
    </section>
  );
}

function Notes() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.notes} className="flex min-h-0 flex-1 flex-col print:h-auto print:flex-none">
      <DropHeading cap={copy.notesCap} rest={copy.notesRest} />
      <Area name="notes" className="min-h-[8.5em] flex-1 print:h-auto print:min-h-0 print:flex-none" />
    </section>
  );
}

function FirstResponder() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.responder} className="flex flex-wrap items-end gap-x-[0.7em] gap-y-[0.15em]">
      <span className="font-bold">{copy.responderLabel}</span>
      <span className="flex min-w-[10em] flex-1 flex-col">
        <Line name="firstResponder_name" />
        <span className="text-[0.75em] font-bold">{copy.responderName}</span>
      </span>
      <span className="font-bold">{copy.responderLast4}</span>
      <Line name="firstResponder_last4" grow={false} className="w-[4.2em]" maxLength={4} inputMode="numeric" />
    </section>
  );
}
