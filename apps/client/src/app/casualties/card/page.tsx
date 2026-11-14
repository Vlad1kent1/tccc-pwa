import { Suspense } from "react";
import { CardView } from "@/components/pages/casualty-card";

export default function CasualtyCardPage() {
  return (
    <Suspense fallback={null}>
      <CardView />
    </Suspense>
  );
}
