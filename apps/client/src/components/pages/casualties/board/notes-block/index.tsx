"use client";

import { memo } from "react";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "@/components/ui/field";
import { editNotes, editResponder, flushBoard, useSlice } from "@/components/pages/casualties/board/store";

export const NotesBlock = memo(function NotesBlock() {
  const { t } = useT();
  const notes = useSlice((state) => state.notes);

  return (
    <section aria-label={t("wizard.fields.notes")} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("wizard.sections.G")}</h2>
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("wizard.fields.notes")}</span>
        <textarea
          className={`${fieldClass} min-h-28 py-3 text-lg`}
          value={notes ?? ""}
          onChange={(event) => editNotes(event.target.value)}
          onBlur={() => flushBoard()}
        />
      </label>
    </section>
  );
});

export const ResponderBlock = memo(function ResponderBlock() {
  const { t } = useT();
  const responder = useSlice((state) => state.responder);

  return (
    <section aria-label={t("wizard.sections.H")} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("wizard.sections.H")}</h2>
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("wizard.fields.responderName")}</span>
        <input
          className={`${fieldClass} min-h-14`}
          value={responder.responderName ?? ""}
          onChange={(event) => editResponder({ responderName: event.target.value || null })}
          onBlur={() => flushBoard()}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("wizard.fields.responderLast4")}</span>
        <input
          inputMode="numeric"
          maxLength={4}
          className={`${fieldClass} min-h-14`}
          value={responder.responderLast4 ?? ""}
          onChange={(event) => editResponder({ responderLast4: event.target.value.replace(/\D/g, "").slice(0, 4) || null })}
          onBlur={() => flushBoard()}
        />
      </label>
    </section>
  );
});
