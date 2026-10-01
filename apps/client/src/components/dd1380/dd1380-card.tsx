"use client";

import { useCallback, useEffect, useState } from "react";
import { CardBack } from "./card-back";
import { CardFront } from "./card-front";
import { formSans, formSerif } from "./fonts";
import { Dd1380FormProvider, type Dd1380Values } from "./form-context";

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

/** Uncontrolled replica for layout previews; edits stay in memory. */
export function Dd1380Preview() {
  const [values, setValues] = useState<Dd1380Values>({});
  const onChange = useCallback((next: Dd1380Values) => setValues(next), []);
  return <Dd1380Card values={values} onChange={onChange} />;
}

export function useDd1380Values(initial: Dd1380Values): [Dd1380Values, (next: Dd1380Values) => void] {
  const [values, setValues] = useState(initial);
  useEffect(() => {
    setValues(initial);
  }, [initial]);
  return [values, setValues];
}

export { CardFront } from "./card-front";
export { CardBack } from "./card-back";
export type { Dd1380Values } from "./form-context";
