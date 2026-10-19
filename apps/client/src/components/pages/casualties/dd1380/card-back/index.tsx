"use client";

import { memo, type ReactNode } from "react";
import { FluidKind, MedicationCategory } from "@tccc/shared";
import { useCardCopy } from "@/components/pages/casualties/dd1380/copy";
import { PAPER_CAPACITY } from "@/components/pages/casualties/dd1380/mapping";
import { PaperFluidInput, PaperFluidRoute, PaperMedicationInput, PaperMedicationRoute } from "@/components/pages/casualties/dd1380/paper-cell";
import { PaperOverflow } from "@/components/pages/casualties/dd1380/paper-overflow";
import { RosterEvac } from "@/components/pages/casualties/dd1380/roster-evac";
import { Area, Dash, DropHeading, Line, Mark, Specify, UaSheet } from "@/components/pages/casualties/dd1380/ua-fields";

function fluidRows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      name: `${prefix}_Name${n}`,
      volume: `${prefix}_Volume${n}`,
      route: `${prefix}_Route${n}`,
      time: `${prefix}_Time${n}`,
    };
  });
}

function medRows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      name: `${prefix}_Name${n}`,
      dose: `${prefix}_Dose${n}`,
      route: `${prefix}_Route${n}`,
      time: `${prefix}_Time${n}`,
    };
  });
}

const FLUID_ROWS = fluidRows("treatment_C_Fluid", PAPER_CAPACITY.fluid);
const BLOOD_ROWS = fluidRows("treatment_C_BloodProduct", PAPER_CAPACITY.blood);
const ANALGESIC_ROWS = medRows("treatment_MEDS_Analgesic", PAPER_CAPACITY.analgesic);
const ANTIBIOTIC_ROWS = medRows("treatment_MEDS_Antibiotic", PAPER_CAPACITY.antibiotic);
const OTHER_MED_ROWS = medRows("treatment_MEDS_Other", PAPER_CAPACITY.otherMedication);

const GRID = "border border-black";
const FLUID_TABLES = ["fluid", "blood"] as const;
const MED_TABLES = ["analgesic", "antibiotic", "otherMedication"] as const;

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
            rows={FLUID_ROWS}
            fields={["name", "volume", "route", "time"]}
            renderCell={(index, field) =>
              field === "route" ? <PaperFluidRoute kind={FluidKind.FLUID} index={index} /> : <PaperFluidInput kind={FluidKind.FLUID} index={index} field={field === "dose" ? "name" : field} />
            }
          />
          <EntryRows
            label={<Stacked text={copy.blood} />}
            rows={BLOOD_ROWS}
            fields={["name", "volume", "route", "time"]}
            renderCell={(index, field) =>
              field === "route" ? (
                <PaperFluidRoute kind={FluidKind.BLOOD_PRODUCT} index={index} />
              ) : (
                <PaperFluidInput kind={FluidKind.BLOOD_PRODUCT} index={index} field={field === "dose" ? "name" : field} />
              )
            }
          />
        </tbody>
      </table>
      <PaperOverflow tables={FLUID_TABLES} />
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
            rows={ANALGESIC_ROWS}
            fields={["name", "dose", "route", "time"]}
            renderCell={(index, field) => medicationCell(MedicationCategory.ANALGESIC, index, field)}
          />
          <EntryRows
            label={<Category title={copy.antibiotic} hint={copy.antibioticHint} />}
            rows={ANTIBIOTIC_ROWS}
            fields={["name", "dose", "route", "time"]}
            renderCell={(index, field) => medicationCell(MedicationCategory.ANTIBIOTIC, index, field)}
          />
          <EntryRows
            label={<Category title={copy.medsOther} hint={copy.medsOtherHint} />}
            shade
            rows={OTHER_MED_ROWS}
            fields={["name", "dose", "route", "time"]}
            renderCell={(index, field) => medicationCell(MedicationCategory.OTHER, index, field)}
          />
        </tbody>
      </table>
      <PaperOverflow tables={MED_TABLES} />
    </section>
  );
}

function medicationCell(category: (typeof MedicationCategory)[keyof typeof MedicationCategory], index: number, field: "name" | "volume" | "dose" | "route" | "time") {
  if (field === "route") return <PaperMedicationRoute category={category} index={index} />;
  if (field === "volume") return <PaperMedicationInput category={category} index={index} field="name" />;
  return <PaperMedicationInput category={category} index={index} field={field} />;
}

function EntryRows({
  label,
  rows,
  fields,
  shade = false,
  renderCell,
}: {
  label: ReactNode;
  rows: readonly { name: string; volume?: string; dose?: string; route: string; time: string }[];
  fields: readonly ["name", "volume" | "dose", "route", "time"];
  shade?: boolean;
  renderCell: (index: number, field: "name" | "volume" | "dose" | "route" | "time") => ReactNode;
}) {
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
          {renderCell(index, field)}
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
