import { Suspense } from "react";
import { CardView } from "@/components/pages/casualties/card-view";

export default function CasualtyCardPage() {
  return (
    <Suspense fallback={null}>
      <CardView />
    </Suspense>
  );
}
