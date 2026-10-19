"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  MedicationCategory,
  Route,
  newId,
  type MedicationCategory as MedicationCategoryName,
  type Route as RouteName,
} from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { formatHmm, lastTimeToken } from "@/lib/forms/time";
import { Block } from "@/components/pages/casualties/board/block";
import { MAX_TABLE_ROWS, useSyncedField } from "@/components/pages/casualties/board/entry";
import { OptionSelect } from "@/components/pages/casualties/board/option-select";
import { StampField } from "@/components/pages/casualties/board/stamp-field";
import { TextField } from "@/components/pages/casualties/board/text-field";
import { saveMedicationFields } from "@/components/pages/casualties/board/rows";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const MedicationsBlock = memo(function MedicationsBlock() {
  const { t, enumLabel } = useT();
  return (
    <Block title={t("block8.title")}>
      <MedicationTable category={MedicationCategory.ANALGESIC} title={enumLabel("MedicationCategory", MedicationCategory.ANALGESIC)} />
      <MedicationTable category={MedicationCategory.ANTIBIOTIC} title={enumLabel("MedicationCategory", MedicationCategory.ANTIBIOTIC)} />
      <MedicationTable category={MedicationCategory.OTHER} title={enumLabel("MedicationCategory", MedicationCategory.OTHER)} />
    </Block>
  );
});

function MedicationTable({ category, title }: { category: MedicationCategoryName; title: string }) {
  const board = useBoard();
  const { t } = useT();
  const medications = useSlice((state) => state.medications);
  const [extra, setExtra] = useState<string[]>([]);
  const storedIds = medications.filter((row) => row.category === category).map((row) => row.id);
  const ids = [...storedIds, ...extra.filter((id) => !medications.some((row) => row.id === id))];
  const remove = useCallback((id: string) => {
    setExtra((items) => items.filter((item) => item !== id));
    board.removeMedication(id);
  }, [board]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="flex flex-col gap-4">
        {ids.map((id) => (
          <MedicationEditor key={id} id={id} category={category} onRemove={remove} />
        ))}
      </div>
      {ids.length < MAX_TABLE_ROWS ? (
        <button type="button" className="btn btn-secondary" onClick={() => setExtra((items) => (ids.length >= MAX_TABLE_ROWS ? items : [...items, newId()]))}>
          {t("actions.addRow")}
        </button>
      ) : null}
    </div>
  );
}

const MedicationEditor = memo(function MedicationEditor({
  id,
  category,
  onRemove,
}: {
  id: string;
  category: MedicationCategoryName;
  onRemove: (id: string) => void;
}) {
  const board = useBoard();
  const { t, enumLabel } = useT();
  const row = useSlice((state) => state.medications.find((item) => item.id === id));
  const name = useSyncedField(row?.name ?? "");
  const dose = useSyncedField(row?.dose ?? "");
  const [timeText, setTimeText] = useState("");
  const timeLock = useRef(false);
  const canonical = row ? formatHmm(row.administeredAt) : "";

  useEffect(() => {
    setTimeText((current) => (timeLock.current || lastTimeToken(current) === canonical ? current || canonical : canonical));
  }, [canonical]);

  function commit(patch?: {
    name?: string;
    dose?: string;
    route?: RouteName | "";
    time?: string;
  }): void {
    saveMedicationFields(board, id, category, {
      name: patch?.name ?? name.value,
      dose: patch?.dose ?? dose.value,
      route: patch?.route ?? row?.route ?? "",
      time: patch?.time ?? timeText,
    });
  }

  const routes = Object.values(Route).map((item) => ({ value: item, label: enumLabel("Route", item) }));

  return (
    <article className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
      <TextField
        label={t("block8.name")}
        maxLength={100}
        value={name.value}
        onFocus={name.onFocus}
        onBlur={() => {
          name.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          name.setValue(value);
          commit({ name: value });
        }}
      />
      <TextField
        label={t("block8.dose")}
        maxLength={50}
        value={dose.value}
        onFocus={dose.onFocus}
        onBlur={() => {
          dose.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          dose.setValue(value);
          commit({ dose: value });
        }}
      />
      <OptionSelect
        label={t("block8.route")}
        value={row?.route ?? ""}
        options={routes}
        onChange={(value) => {
          commit({ route: value as RouteName | "" });
          board.flush();
        }}
      />
      <StampField
        label={t("block8.time")}
        value={timeText}
        onChange={(value) => {
          timeLock.current = true;
          setTimeText(value);
          commit({ time: value });
        }}
        onBlur={() => board.flush()}
      />
      <button type="button" className="btn btn-secondary sm:col-span-2" onClick={() => onRemove(id)}>
        {t("actions.remove")}
      </button>
    </article>
  );
});
