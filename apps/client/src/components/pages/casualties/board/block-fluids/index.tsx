"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FluidKind, Route, newId, type FluidKind as FluidKindName, type Route as RouteName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { formatHmm, lastTimeToken } from "@/lib/forms/time";
import { Block } from "@/components/pages/casualties/board/block";
import { MAX_TABLE_ROWS, useSyncedField } from "@/components/pages/casualties/board/entry";
import { OptionSelect } from "@/components/pages/casualties/board/option-select";
import { StampField } from "@/components/pages/casualties/board/stamp-field";
import { TextField } from "@/components/pages/casualties/board/text-field";
import { saveFluidFields } from "@/components/pages/casualties/board/rows";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const FluidsBlock = memo(function FluidsBlock() {
  const { t } = useT();
  return (
    <Block title={t("block7.title")}>
      <FluidTable kind={FluidKind.FLUID} title={t("block7.fluids")} />
      <FluidTable kind={FluidKind.BLOOD_PRODUCT} title={t("block7.blood")} />
    </Block>
  );
});

function FluidTable({ kind, title }: { kind: FluidKindName; title: string }) {
  const board = useBoard();
  const { t } = useT();
  const fluids = useSlice((state) => state.fluids);
  const [extra, setExtra] = useState<string[]>([]);
  const storedIds = fluids.filter((row) => row.kind === kind).map((row) => row.id);
  const ids = [...storedIds, ...extra.filter((id) => !fluids.some((row) => row.id === id))];
  const remove = useCallback((id: string) => {
    setExtra((items) => items.filter((item) => item !== id));
    board.removeFluid(id);
  }, [board]);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="flex flex-col gap-4">
        {ids.map((id) => (
          <FluidEditor key={id} id={id} kind={kind} onRemove={remove} />
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

const FluidEditor = memo(function FluidEditor({
  id,
  kind,
  onRemove,
}: {
  id: string;
  kind: FluidKindName;
  onRemove: (id: string) => void;
}) {
  const board = useBoard();
  const { t, enumLabel } = useT();
  const row = useSlice((state) => state.fluids.find((item) => item.id === id));
  const name = useSyncedField(row?.name ?? "");
  const volume = useSyncedField(row?.volumeMl == null ? "" : String(row.volumeMl));
  const [timeText, setTimeText] = useState("");
  const timeLock = useRef(false);
  const canonical = row ? formatHmm(row.administeredAt) : "";

  useEffect(() => {
    setTimeText((current) => (timeLock.current || lastTimeToken(current) === canonical ? current || canonical : canonical));
  }, [canonical]);

  function commit(patch?: { name?: string; volume?: string; route?: RouteName | ""; time?: string }): void {
    saveFluidFields(board, id, kind, {
      name: patch?.name ?? name.value,
      volume: patch?.volume ?? volume.value,
      route: patch?.route ?? row?.route ?? "",
      time: patch?.time ?? timeText,
    });
  }

  const routes = Object.values(Route).map((item) => ({ value: item, label: enumLabel("Route", item) }));

  return (
    <article className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
      <TextField
        label={t("block7.name")}
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
        label={t("block7.volume")}
        inputMode="numeric"
        value={volume.value}
        onFocus={volume.onFocus}
        onBlur={() => {
          volume.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 5);
          volume.setValue(digits);
          commit({ volume: digits });
        }}
      />
      <OptionSelect
        label={t("block7.route")}
        value={row?.route ?? ""}
        options={routes}
        onChange={(value) => {
          commit({ route: value as RouteName | "" });
          board.flush();
        }}
      />
      <StampField
        label={t("block7.time")}
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
