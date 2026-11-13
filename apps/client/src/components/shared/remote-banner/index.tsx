"use client";

import { useT } from "@/i18n/use-t";
import { useBoard, useSlice } from "@/lib/board";

/** A newer version of the card arrived while this store had unsaved edits. */
export function RemoteBanner() {
  const { t } = useT();
  const board = useBoard();
  const remote = useSlice((state) => state.remote);
  if (!remote) return null;
  return (
    <div role="status" data-print-hide className="banner-warning">
      <p className="text-sm font-medium">{t("card.remoteChange")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={board.keepEdits}>
          {t("card.keepMine")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={board.loadUpdate}>
          {t("card.loadUpdated")}
        </button>
      </div>
    </div>
  );
}
