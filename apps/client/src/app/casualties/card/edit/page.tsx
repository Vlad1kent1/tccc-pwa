import { Suspense } from "react";
import { TacticalBoard } from "@/components/pages/casualty-board";

export default function EditCasualtyPage() {
  return (
    <Suspense fallback={null}>
      <TacticalBoard mode="edit" />
    </Suspense>
  );
}
