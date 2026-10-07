"use client";

import { CardBack } from "@/components/pages/casualties/dd1380/card-back";
import { CardFront } from "@/components/pages/casualties/dd1380/card-front";
import { formSans, formSerif } from "@/components/pages/casualties/dd1380/fonts";
import { Dd1380FormProvider, type Dd1380Values } from "@/components/pages/casualties/dd1380/form-context";

export function Dd1380Card({
  values,
  onChange,
}: {
  values: Dd1380Values;
  onChange: (values: Dd1380Values) => void;
}) {
  return (
    <Dd1380FormProvider values={values} onChange={onChange}>
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5cm;
          }
        }
      `}</style>
      <div
        data-dd1380
        className={`${formSans.variable} ${formSerif.variable} dd1380-root grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 lg:gap-4 print:m-0 print:flex print:flex-col print:gap-0 print:shadow-none`}
      >
        <CardFront />
        <CardBack />
      </div>
    </Dd1380FormProvider>
  );
}
