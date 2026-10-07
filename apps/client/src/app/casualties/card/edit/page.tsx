import { Suspense } from "react";
import { TacticalBoard } from "@/components/pages/casualties/board/tactical-board";

export default function EditCasualtyPage() {
  return (
    <Suspense fallback={null}>
      <TacticalBoard mode="edit" />
    </Suspense>
  );
}
