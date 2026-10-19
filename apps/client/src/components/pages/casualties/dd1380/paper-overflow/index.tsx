"use client";

import { useCardCopy, type CardCopy } from "@/components/pages/casualties/dd1380/copy";
import { hiddenRows, type PaperTableName } from "@/components/pages/casualties/board/paper-layout";
import { useSlice } from "@/components/pages/casualties/board/store";

const LABEL: Readonly<Record<PaperTableName, keyof CardCopy>> = {
  vitals: "overflowVitals",
  fluid: "overflowFluid",
  blood: "overflowBlood",
  analgesic: "overflowAnalgesic",
  antibiotic: "overflowAntibiotic",
  otherMedication: "overflowOtherMeds",
};

/**
 * Printed under a table that holds more rows than the paper card has columns or
 * lines for, so a fifth analgesic dose cannot vanish from the printout unnoticed.
 */
export function PaperOverflow({ tables }: { tables: readonly PaperTableName[] }) {
  const copy = useCardCopy();
  // A string, so the note re-renders only when a count changes.
  const counts = useSlice((state) => tables.map((table) => hiddenRows(state, state.paper, table)).join(","));
  const parts = counts
    .split(",")
    .map(Number)
    .flatMap((hidden, index) => (hidden > 0 ? [`${copy[LABEL[tables[index]!]]} +${hidden}`] : []));
  if (parts.length === 0) return null;
  return (
    <p role="note" className="mt-[0.2em] border border-black px-[0.3em] py-[0.1em] leading-tight font-bold">
      {copy.overflowLead} {parts.join(", ")}. {copy.overflowTail}
    </p>
  );
}
