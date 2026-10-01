import { Suspense } from "react";
import { CardWizard } from "@/components/card-wizard";

export default function NewCasualtyPage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8" />}>
      <CardWizard />
    </Suspense>
  );
}
