"use client";

import { memo } from "react";
import { CardBack } from "@/components/pages/casualties/dd1380/card-back";
import { CardFront } from "@/components/pages/casualties/dd1380/card-front";
import { formSans, formSerif } from "@/components/pages/casualties/dd1380/fonts";
import { Dd1380FormProvider, type Dd1380FormSource } from "@/components/pages/casualties/dd1380/form-context";
import { InjuryMarksProvider, type StoredMark } from "@/components/pages/casualties/dd1380/injury-section";

const NO_MARKS: readonly StoredMark[] = [];

/** Re-renders only when `source` or `marks` change identity; fields update themselves. */
export const Dd1380Card = memo(function Dd1380Card({
  source,
  marks = NO_MARKS,
}: {
  source: Dd1380FormSource;
  marks?: readonly StoredMark[];
}) {
  return (
    <Dd1380FormProvider source={source}>
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
    </Dd1380FormProvider>
  );
});
