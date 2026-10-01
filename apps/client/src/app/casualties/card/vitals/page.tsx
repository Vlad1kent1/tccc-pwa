import { Suspense } from "react";
import { QuickVitalsForm } from "@/components/quick-vitals-form";

export default function QuickVitalsPage() {
  return (
    <Suspense fallback={null}>
      <QuickVitalsForm />
    </Suspense>
  );
}
