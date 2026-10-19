"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/use-t";
import { useBoard } from "@/components/pages/casualties/board/store";

export function SaveBar() {
  const { t } = useT();
  const router = useRouter();
  const board = useBoard();
  const [pending, setPending] = useState(false);

  async function save(): Promise<void> {
    if (pending) return;
    setPending(true);
    const saved = await board.save();
    if (!saved) {
      setPending(false);
      return;
    }
    // Leaving the page releases this store; the next new casualty starts a fresh draft.
    router.push("/");
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 flex justify-end border-t border-border bg-background/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur supports-backdrop-filter:bg-background/60">
      <button type="button" className="btn btn-primary min-h-14" disabled={pending} onClick={() => void save()}>
        {t("actions.save")}
      </button>
    </div>
  );
}
