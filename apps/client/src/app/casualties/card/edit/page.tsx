import { Suspense } from "react";
import { SectionTabs } from "@/components/card-editor";

export default function EditCasualtyPage() {
  return (
    <Suspense fallback={null}>
      <SectionTabs />
    </Suspense>
  );
}
