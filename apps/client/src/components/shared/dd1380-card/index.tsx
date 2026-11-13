"use client";

import { memo } from "react";
import type { Dd1380FormSource, StoredMark } from "@tccc/dd1380";
import { CardBack, CardFront, InjuryMarksProvider } from "./components";
import { Dd1380FormProvider, PaperCellsProvider, formSans, formSerif, type PaperCells } from "./workflow";

export { useCardChoices, type ChoiceOption } from "./components";
export { useCardCopy, type CardCopy, type PaperCells } from "./workflow";

const NO_MARKS: readonly StoredMark[] = [];

/** Re-renders only when `source`, `marks` or `cells` change identity; fields update themselves. */
export const Dd1380Card = memo(function Dd1380Card({
  source,
  marks = NO_MARKS,
  cells,
}: {
  source: Dd1380FormSource;
  marks?: readonly StoredMark[];
  /** The editable table cells, supplied by the page (see `PaperCells`). */
  cells: PaperCells;
}) {
  return (
    <Dd1380FormProvider source={source}>
      <PaperCellsProvider cells={cells}>
      <InjuryMarksProvider marks={marks}>
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5cm;
          }
        }
      `}</style>
      <div
        data-dd1380
        className={`${formSans.variable} ${formSerif.variable} dd1380-root grid grid-cols-1 items-stretch lg:grid-cols-2 print:m-0 print:flex print:flex-col print:shadow-none`}
      >
        <CardFront />
        <CardBack />
      </div>
      </InjuryMarksProvider>
      </PaperCellsProvider>
    </Dd1380FormProvider>
  );
});
