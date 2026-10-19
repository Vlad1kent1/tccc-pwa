"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Avpu, newId, type Avpu as AvpuName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { formatHmm, lastTimeToken } from "@/lib/forms/time";
import { Block } from "@/components/pages/casualties/board/block";
import { MAX_TABLE_ROWS, boundedInt, useSyncedField } from "@/components/pages/casualties/board/entry";
import { OptionSelect } from "@/components/pages/casualties/board/option-select";
import { StampField } from "@/components/pages/casualties/board/stamp-field";
import { TextField } from "@/components/pages/casualties/board/text-field";
import { saveVitalFields } from "@/components/pages/casualties/board/rows";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";

export const VitalsBlock = memo(function VitalsBlock() {
  const board = useBoard();
  const { t } = useT();
  const vitals = useSlice((state) => state.vitals);
  const [extra, setExtra] = useState<string[]>([]);
  const storedIds = vitals.map((row) => row.id);
  const ids = [...storedIds, ...extra.filter((id) => !storedIds.includes(id))];
  const remove = useCallback((id: string) => {
    setExtra((items) => items.filter((item) => item !== id));
    board.removeVital(id);
  }, [board]);

  return (
    <Block title={t("block5.title")}>
      {ids.length === 0 ? <p className="text-sm text-muted">{t("block5.empty")}</p> : null}
      <div className="flex flex-col gap-4">
        {ids.map((id) => (
          <VitalEditor key={id} id={id} onRemove={remove} />
        ))}
      </div>
      {ids.length < MAX_TABLE_ROWS ? (
        <button
          type="button"
          className="btn btn-secondary min-h-14"
          onClick={() => setExtra((items) => (ids.length >= MAX_TABLE_ROWS ? items : [...items, newId()]))}
        >
          {t("actions.addRow")}
        </button>
      ) : null}
    </Block>
  );
});

const VitalEditor = memo(function VitalEditor({ id, onRemove }: { id: string; onRemove: (id: string) => void }) {
  const board = useBoard();
  const { t } = useT();
  const row = useSlice((state) => state.vitals.find((item) => item.id === id));
  const pulse = useSyncedField(row?.pulseRate == null ? "" : String(row.pulseRate));
  const location = useSyncedField(row?.pulseLocation ?? "");
  const systolic = useSyncedField(row?.systolic == null ? "" : String(row.systolic));
  const diastolic = useSyncedField(row?.diastolic == null ? "" : String(row.diastolic));
  const respiratory = useSyncedField(row?.respiratoryRate == null ? "" : String(row.respiratoryRate));
  const spo2 = useSyncedField(row?.spo2 == null ? "" : String(row.spo2));
  const [timeText, setTimeText] = useState("");
  const [bpError, setBpError] = useState(false);
  const timeLock = useRef(false);
  const draftedTime = useSlice((state) => state.rowDrafts[id]?.time ?? "");
  const canonical = row ? formatHmm(row.measuredAt) : "";

  useEffect(() => {
    setTimeText((current) => (timeLock.current ? current : draftedTime || (lastTimeToken(current) === canonical ? current || canonical : canonical)));
  }, [canonical, draftedTime]);

  function commit(patch: {
    pulse?: string;
    location?: string;
    systolic?: string;
    diastolic?: string;
    respiratory?: string;
    spo2?: string;
    avpu?: AvpuName | null;
    pain?: number | null;
    time?: string;
  }): void {
    const systolicText = patch.systolic ?? systolic.value;
    const diastolicText = patch.diastolic ?? diastolic.value;
    const sys = boundedInt(systolicText, 0, 300);
    const dia = boundedInt(diastolicText, 0, 200);
    setBpError(sys != null && dia != null && sys < dia);
    const pain = patch.pain === undefined ? (row?.painScale == null ? "" : String(row.painScale)) : patch.pain == null ? "" : String(patch.pain);
    saveVitalFields(board, id, {
      time: patch.time ?? timeText,
      pulse: patch.pulse ?? pulse.value,
      location: patch.location ?? location.value,
      systolic: systolicText,
      diastolic: diastolicText,
      respiratory: patch.respiratory ?? respiratory.value,
      spo2: patch.spo2 ?? spo2.value,
      avpu: patch.avpu === undefined ? (row?.avpu ?? null) : patch.avpu,
      pain,
    });
  }

  const avpuOptions = [
    { value: Avpu.ALERT, label: t("block5.avpuAlert") },
    { value: Avpu.VERBAL, label: t("block5.avpuVerbal") },
    { value: Avpu.PAIN, label: t("block5.avpuPain") },
    { value: Avpu.UNRESPONSIVE, label: t("block5.avpuUnresponsive") },
  ];
  const painOptions = Array.from({ length: 11 }, (_, score) => ({ value: String(score), label: t(`block5.pain${score}`) }));

  return (
    <article className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 md:grid-cols-4">
      <StampField
        label={t("block5.vitals.time")}
        value={timeText}
        onChange={(value) => {
          timeLock.current = true;
          setTimeText(value);
          commit({ time: value });
        }}
        onBlur={() => board.flush()}
      />
      <TextField
        label={t("block5.vitals.pulse")}
        inputMode="numeric"
        value={pulse.value}
        onFocus={pulse.onFocus}
        onBlur={() => {
          pulse.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 3);
          pulse.setValue(digits);
          commit({ pulse: digits });
        }}
      />
      <TextField
        label={t("block5.vitals.pulseLocation")}
        maxLength={30}
        value={location.value}
        onFocus={location.onFocus}
        onBlur={() => {
          location.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          location.setValue(value);
          commit({ location: value });
        }}
      />
      <TextField
        label={t("block5.vitals.systolic")}
        inputMode="numeric"
        value={systolic.value}
        onFocus={systolic.onFocus}
        onBlur={() => {
          systolic.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 3);
          systolic.setValue(digits);
          commit({ systolic: digits });
        }}
      />
      <TextField
        label={t("block5.vitals.diastolic")}
        inputMode="numeric"
        value={diastolic.value}
        onFocus={diastolic.onFocus}
        onBlur={() => {
          diastolic.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 3);
          diastolic.setValue(digits);
          commit({ diastolic: digits });
        }}
      />
      <TextField
        label={t("block5.vitals.respiratoryRate")}
        inputMode="numeric"
        value={respiratory.value}
        onFocus={respiratory.onFocus}
        onBlur={() => {
          respiratory.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 2);
          respiratory.setValue(digits);
          commit({ respiratory: digits });
        }}
      />
      <TextField
        label={t("block5.vitals.o2Sat")}
        inputMode="numeric"
        value={spo2.value}
        onFocus={spo2.onFocus}
        onBlur={() => {
          spo2.onBlur();
          board.flush();
        }}
        onChange={(value) => {
          const digits = value.replace(/\D/g, "").slice(0, 3);
          spo2.setValue(digits);
          commit({ spo2: digits });
        }}
      />
      <OptionSelect
        label={t("block5.vitals.avpu")}
        value={row?.avpu ?? ""}
        options={avpuOptions}
        onChange={(value) => {
          commit({ avpu: value ? (value as AvpuName) : null });
          board.flush();
        }}
      />
      <OptionSelect
        label={t("block5.vitals.pain")}
        value={row?.painScale == null ? "" : String(row.painScale)}
        options={painOptions}
        onChange={(value) => {
          commit({ pain: value === "" ? null : Number(value) });
          board.flush();
        }}
      />
      <div className="col-span-2 flex items-end md:col-span-1">
        <button type="button" className="btn btn-secondary w-full" onClick={() => onRemove(id)}>
          {t("actions.remove")}
        </button>
      </div>
      {bpError ? <p className="col-span-full error-text">{t("block5.bpInvalid")}</p> : null}
    </article>
  );
});
