"use client";

import type { ReactNode } from "react";
import { useCardCopy } from "./copy";
import { RosterEvac } from "./roster-evac";
import { Area, Cell, Dash, DropHeading, Line, Mark, Pick, Specify, UaSheet, useCardChoices } from "./ua-fields";

const FLUID_ROWS = [
  { name: "treatment_C_Fluid_Name1", volume: "treatment_C_Fluid_Volume1", route: "treatment_C_Fluid_Route1", time: "treatment_C_Fluid_Time1" },
  { name: "treatment_C_Fluid_Name2", volume: "treatment_C_Fluid_Volume2", route: "treatment_C_Fluid_Route2", time: "treatment_C_Fluid_Time2" },
  { name: "treatment_C_BloodProduct_Name1", volume: "treatment_C_BloodProduct_Volume1", route: "treatment_C_BloodProduct_Route1", time: "treatment_C_BloodProduct_Time1" },
  { name: "treatment_C_BloodProduct_Name2", volume: "treatment_C_BloodProduct_Volume2", route: "treatment_C_BloodProduct_Route2", time: "treatment_C_BloodProduct_Time2" },
] as const;

const MED_ROWS = [
  { name: "treatment_MEDS_Analgesic_Name1", dose: "treatment_MEDS_Analgesic_Dose1", route: "treatment_MEDS_Analgesic_Route1", time: "treatment_MEDS_Analgesic_Time1" },
  { name: "treatment_MEDS_Analgesic_Name2", dose: "treatment_MEDS_Analgesic_Dose2", route: "treatment_MEDS_Analgesic_Route2", time: "treatment_MEDS_Analgesic_Time2" },
  { name: "treatment_MEDS_Analgesic_Name3", dose: "treatment_MEDS_Analgesic_Dose3", route: "treatment_MEDS_Analgesic_Route3", time: "treatment_MEDS_Analgesic_Time3" },
  { name: "treatment_MEDS_Antibiotic_Name1", dose: "treatment_MEDS_Antibiotic_Dose1", route: "treatment_MEDS_Antibiotic_Route1", time: "treatment_MEDS_Antibiotic_Time1" },
  { name: "treatment_MEDS_Antibiotic_Name2", dose: "treatment_MEDS_Antibiotic_Dose2", route: "treatment_MEDS_Antibiotic_Route2", time: "treatment_MEDS_Antibiotic_Time2" },
  { name: "treatment_MEDS_Other_Name1", dose: "treatment_MEDS_Other_Dose1", route: "treatment_MEDS_Other_Route1", time: "treatment_MEDS_Other_Time1" },
  { name: "treatment_MEDS_Other_Name2", dose: "treatment_MEDS_Other_Dose2", route: "treatment_MEDS_Other_Route2", time: "treatment_MEDS_Other_Time2" },
] as const;

const GRID = "border border-black";

export function CardBack() {
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
}

function Treatments() {
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

function FluidsTable() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.fluids} className="mt-[0.35em]">
      <table className="ua-grid w-full table-fixed border-collapse text-center">
        <colgroup>
          <col className="w-[4%]" />
          <col className="w-[18%]" />
          <col />
          <col className="w-[13%]" />
          <col className="w-[15%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr>
            <td className={` text-left font-bold`}>C:</td>
            <td  />
            <th className={GRID}>{copy.nameCol}</th>
            <th className={GRID}>{copy.volume}</th>
            <th className={`${GRID} leading-tight whitespace-pre-line`}>{copy.route}</th>
            <th className={GRID}>{copy.timeHeader}</th>
          </tr>
        </thead>
        <tbody>
          <EntryRows
            label={<Stacked text={copy.fluid} />}
            shade
            rows={FLUID_ROWS.slice(0, 2)}
            fields={["name", "volume", "route", "time"]}
          />
          <EntryRows
            label={<Stacked text={copy.blood} />}
            rows={FLUID_ROWS.slice(2)}
            fields={["name", "volume", "route", "time"]}
          />
        </tbody>
      </table>
    </section>
  );
}

function MedsTable() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.medsSection} className="mt-[0.45em]">
      <table className="ua-grid w-full table-fixed border-collapse text-center">
        <colgroup>
          <col className="w-[4%]" />
          <col className="w-[18%]" />
          <col />
          <col className="w-[13%]" />
          <col className="w-[15%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr>
            <td colSpan={2} className={`text-left font-bold`}>
              {copy.meds}
            </td>
            <th className={GRID}>{copy.nameCol}</th>
            <th className={GRID}>{copy.dose}</th>
            <th className={`${GRID} leading-tight whitespace-pre-line`}>{copy.route}</th>
            <th className={GRID}>{copy.timeHeader}</th>
          </tr>
        </thead>
        <tbody>
          <EntryRows
            label={<Category title={copy.analgesic} hint={copy.analgesicHint} />}
            shade
            rows={MED_ROWS.slice(0, 3)}
            fields={["name", "dose", "route", "time"]}
          />
          <EntryRows
            label={<Category title={copy.antibiotic} hint={copy.antibioticHint} />}
            rows={MED_ROWS.slice(3, 5)}
            fields={["name", "dose", "route", "time"]}
          />
          <EntryRows
            label={<Category title={copy.medsOther} hint={copy.medsOtherHint} />}
            shade
            rows={MED_ROWS.slice(5)}
            fields={["name", "dose", "route", "time"]}
          />
        </tbody>
      </table>
    </section>
  );
}

function EntryRows({
  label,
  rows,
  fields,
  shade = false,
}: {
  label: ReactNode;
  rows: readonly { name: string; volume?: string; dose?: string; route: string; time: string }[];
  fields: readonly ["name", "volume" | "dose", "route", "time"];
  shade?: boolean;
}) {
  const choices = useCardChoices();
  const tone = shade ? "bg-[#dcdcdc]" : "bg-white";
  return rows.map((row, index) => (
    <tr key={row.name} className={tone}>
      <td className="bg-white"/>
      {index === 0 ? (
        <td rowSpan={rows.length} className={`${GRID} ${tone} px-[0.2em] leading-tight`}>
          {label}
        </td>
      ) : null}
      {fields.map((field) => (
        <td key={field} className={`${GRID} ${tone}`}>
          {field === "route" ? <Pick name={row.route} options={choices.route} /> : <Cell name={row[field]!} />}
        </td>
      ))}
    </tr>
  ));
}

function Category({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <Stacked text={title} />
      {hint ? (
        <span className="mt-[0.1em] block text-[0.72em] leading-tight font-normal whitespace-pre-line italic">{hint}</span>
      ) : null}
    </>
  );
}

function Stacked({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

function Other() {
  const copy = useCardCopy();
  return (
    <section aria-label={copy.otherSection} className="mt-[0.4em] grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[0.4em] gap-y-[0.16em]">
      <span className="inline-flex items-end font-bold">
        {copy.otherLabel}
        <Specify name="treatment_other_specify" />
      </span>
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
