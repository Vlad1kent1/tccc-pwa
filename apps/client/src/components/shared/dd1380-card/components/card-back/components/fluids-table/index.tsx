"use client";

import { FluidKind } from "@tccc/shared";
import { PAPER_CAPACITY } from "@tccc/dd1380";
import { useCardCopy, usePaperCells } from "@/components/shared/dd1380-card/workflow";
import { EntryRows, GRID, Stacked } from "../entry-rows";

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

const FLUID_ROWS = fluidRows("treatment_C_Fluid", PAPER_CAPACITY.fluid);
const BLOOD_ROWS = fluidRows("treatment_C_BloodProduct", PAPER_CAPACITY.blood);
const FLUID_TABLES = ["fluid", "blood"] as const;

export function FluidsTable() {
  const copy = useCardCopy();
  const { FluidInput, FluidRoute, Overflow } = usePaperCells();
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
              field === "route" ? <FluidRoute kind={FluidKind.FLUID} index={index} /> : <FluidInput kind={FluidKind.FLUID} index={index} field={field === "dose" ? "name" : field} />
            }
          />
          <EntryRows
            label={<Stacked text={copy.blood} />}
            rows={BLOOD_ROWS}
            fields={["name", "volume", "route", "time"]}
            renderCell={(index, field) =>
              field === "route" ? (
                <FluidRoute kind={FluidKind.BLOOD_PRODUCT} index={index} />
              ) : (
                <FluidInput kind={FluidKind.BLOOD_PRODUCT} index={index} field={field === "dose" ? "name" : field} />
              )
            }
          />
        </tbody>
      </table>
      <Overflow tables={FLUID_TABLES} />
    </section>
  );
}
