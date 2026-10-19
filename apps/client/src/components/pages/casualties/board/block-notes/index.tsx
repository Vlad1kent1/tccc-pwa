"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { useT } from "@/i18n/use-t";
import { Block } from "@/components/pages/casualties/board/block";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const NotesBlock = memo(function NotesBlock() {
  const board = useBoard();
  const { t } = useT();
  const notes = useSlice((state) => state.notes);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.max(field.scrollHeight, 128)}px`;
  }, [notes]);

  return (
    <Block title={t("block10.title")}>
      <textarea
        ref={ref}
        aria-label={t("block10.notes")}
        className="input min-h-32 resize-none overflow-hidden py-3 text-lg"
        maxLength={4000}
        placeholder={t("block10.placeholder")}
        value={notes ?? ""}
        onChange={(event) => board.editNotes(event.target.value)}
        onBlur={() => board.flush()}
      />
    </Block>
  );
});
