"use client";

import { MedicationCategory } from "@tccc/shared";
import { PAPER_CAPACITY } from "@tccc/dd1380";
import { useCardCopy, usePaperCells, type PaperCells } from "@/components/shared/dd1380-card/workflow";
import { Category, EntryRows, GRID } from "../entry-rows";

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

const ANALGESIC_ROWS = medRows("treatment_MEDS_Analgesic", PAPER_CAPACITY.analgesic);
const ANTIBIOTIC_ROWS = medRows("treatment_MEDS_Antibiotic", PAPER_CAPACITY.antibiotic);
const OTHER_MED_ROWS = medRows("treatment_MEDS_Other", PAPER_CAPACITY.otherMedication);
const MED_TABLES = ["analgesic", "antibiotic", "otherMedication"] as const;

export function MedsTable() {
  const copy = useCardCopy();
  const cells = usePaperCells();
  const { Overflow } = cells;
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
            renderCell={(index, field) => medicationCell(cells, MedicationCategory.ANALGESIC, index, field)}
          />
          <EntryRows
            label={<Category title={copy.antibiotic} hint={copy.antibioticHint} />}
            rows={ANTIBIOTIC_ROWS}
            fields={["name", "dose", "route", "time"]}
            renderCell={(index, field) => medicationCell(cells, MedicationCategory.ANTIBIOTIC, index, field)}
          />
          <EntryRows
            label={<Category title={copy.medsOther} hint={copy.medsOtherHint} />}
            shade
            rows={OTHER_MED_ROWS}
            fields={["name", "dose", "route", "time"]}
            renderCell={(index, field) => medicationCell(cells, MedicationCategory.OTHER, index, field)}
          />
        </tbody>
      </table>
      <Overflow tables={MED_TABLES} />
    </section>
  );
}

function medicationCell(cells: PaperCells, category: (typeof MedicationCategory)[keyof typeof MedicationCategory], index: number, field: "name" | "volume" | "dose" | "route" | "time") {
  const { MedicationInput, MedicationRoute } = cells;
  if (field === "route") return <MedicationRoute category={category} index={index} />;
  if (field === "volume") return <MedicationInput category={category} index={index} field="name" />;
  return <MedicationInput category={category} index={index} field={field} />;
}
