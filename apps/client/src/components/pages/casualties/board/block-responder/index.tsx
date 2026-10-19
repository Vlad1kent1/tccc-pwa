"use client";

import { memo } from "react";
import { useT } from "@/i18n/use-t";
import { Block } from "@/components/pages/casualties/board/block";
import { TextField } from "@/components/pages/casualties/board/text-field";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const ResponderBlock = memo(function ResponderBlock() {
  const board = useBoard();
  const { t } = useT();
  const responderName = useSlice((state) => state.responder.responderName);
  const responderLast4 = useSlice((state) => state.responder.responderLast4);

  return (
    <Block title={t("block11.title")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <TextField
          label={t("block11.name")}
          maxLength={100}
          value={responderName ?? ""}
          onChange={(value) => board.editResponder({ responderName: value || null })}
          onBlur={() => board.flush()}
        />
        <TextField
          label={t("block11.last4")}
          inputMode="numeric"
          maxLength={4}
          value={responderLast4 ?? ""}
          onChange={(value) => board.editResponder({ responderLast4: value.replace(/\D/g, "").slice(0, 4) || null })}
          onBlur={() => board.flush()}
        />
        <button type="button" className="btn btn-primary min-h-14" onClick={() => void board.autoFillResponder()}>
          {t("actions.autoFillResponder")}
        </button>
      </div>
    </Block>
  );
});
