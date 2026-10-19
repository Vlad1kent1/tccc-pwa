"use client";

import type { FluidKind as FluidKindName, MedicationCategory as MedicationCategoryName } from "@tccc/shared";
import { formatHmm } from "@/lib/forms/time";
import { parseAvpu, parseRoute, routeToPaper } from "@/components/pages/casualties/dd1380/mapping";
import { useCardChoices } from "@/components/pages/casualties/dd1380/ua-fields";
import { fluidColumn, medicationColumn, vitalColumn } from "@/components/pages/casualties/board/paper-layout";
import {
  paperRow,
  saveFluidSlot,
  saveMedicationSlot,
  saveVitalSlot,
  type FluidDraft,
  type MedicationDraft,
  type VitalDraft,
} from "@/components/pages/casualties/board/rows";
import { useBoard, useSlice } from "@/components/pages/casualties/board/store";
import type { BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

const inputClass = "w-full min-w-0 bg-transparent px-[0.1em] text-center font-normal text-black outline-none";

/** Unfinished text of one cell. Subscribing to all drafts would re-render every cell on each keystroke. */
function useCellDraft(rowId: string | undefined, field: string): string | undefined {
  return useSlice((state) => (rowId ? state.rowDrafts[rowId]?.[field] : undefined));
}

export function PaperVitalInput({ index, field }: { index: number; field: Exclude<keyof VitalDraft, "avpu"> }) {
  const board = useBoard();
  const row = useSlice((state) => paperRow(state, state.vitals, vitalColumn(index)));
  const draft = useCellDraft(row?.id, field);
  const stored = storedVital(row, field);
  const value = draft || stored;
  return (
    <input
      value={row ? value : ""}
      onChange={(event) => saveVitalSlot(board, index, { [field]: event.target.value })}
      onBlur={() => board.flush()}
      className={inputClass}
    />
  );
}

export function PaperVitalSelect({ index, field }: { index: number; field: "avpu" | "pain" }) {
  const board = useBoard();
  const choices = useCardChoices();
  const row = useSlice((state) => paperRow(state, state.vitals, vitalColumn(index)));
  const draft = useCellDraft(row?.id, field);
  const options = field === "avpu" ? choices.avpu : choices.pain;
  const stored = field === "avpu" ? (row?.avpu ?? "") : row?.painScale == null ? "" : String(row.painScale);
  const value = draft || (field === "avpu" ? avpuPaper(stored) : painPaper(stored, options));
  return (
    <select
      value={options.some((option) => option.value === value) ? value : ""}
      onChange={(event) => {
        const next = event.target.value;
        if (field === "avpu") saveVitalSlot(board, index, { avpu: parseAvpu(next) });
        else saveVitalSlot(board, index, { pain: next.match(/^\d+/)?.[0] ?? "" });
      }}
      onBlur={() => board.flush()}
      className="ua-select"
    >
      <option value=""> </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function PaperFluidInput({
  kind,
  index,
  field,
}: {
  kind: FluidKindName;
  index: number;
  field: Exclude<keyof FluidDraft, "route">;
}) {
  const board = useBoard();
  const row = useSlice((state) => paperRow(state, state.fluids, fluidColumn(kind, index)));
  const draft = useCellDraft(row?.id, field);
  const stored =
    field === "name" ? (row?.name ?? "") : field === "volume" ? (row?.volumeMl == null ? "" : String(row.volumeMl)) : formatHmm(row?.administeredAt ?? null);
  const value = draft || stored;
  return (
    <input
      value={value}
      onChange={(event) => saveFluidSlot(board, kind, index, { [field]: event.target.value })}
      onBlur={() => board.flush()}
      className={inputClass}
    />
  );
}

export function PaperFluidRoute({ kind, index }: { kind: FluidKindName; index: number }) {
  const board = useBoard();
  const choices = useCardChoices();
  const row = useSlice((state) => paperRow(state, state.fluids, fluidColumn(kind, index)));
  const value = routeToPaper(row?.route ?? null);
  return (
    <select
      value={value}
      onChange={(event) => saveFluidSlot(board, kind, index, { route: parseRoute(event.target.value) ?? "" })}
      onBlur={() => board.flush()}
      className="ua-select"
    >
      <option value=""> </option>
      {choices.route.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function PaperMedicationInput({
  category,
  index,
  field,
}: {
  category: MedicationCategoryName;
  index: number;
  field: Exclude<keyof MedicationDraft, "route">;
}) {
  const board = useBoard();
  const row = useSlice((state) => paperRow(state, state.medications, medicationColumn(category, index)));
  const draft = useCellDraft(row?.id, field);
  const stored = field === "name" ? (row?.name ?? "") : field === "dose" ? (row?.dose ?? "") : formatHmm(row?.administeredAt ?? null);
  const value = draft || stored;
  return (
    <input
      value={value}
      onChange={(event) => saveMedicationSlot(board, category, index, { [field]: event.target.value })}
      onBlur={() => board.flush()}
      className={inputClass}
    />
  );
}

export function PaperMedicationRoute({ category, index }: { category: MedicationCategoryName; index: number }) {
  const board = useBoard();
  const choices = useCardChoices();
  const row = useSlice((state) => paperRow(state, state.medications, medicationColumn(category, index)));
  const value = routeToPaper(row?.route ?? null);
  return (
    <select
      value={value}
      onChange={(event) => saveMedicationSlot(board, category, index, { route: parseRoute(event.target.value) ?? "" })}
      onBlur={() => board.flush()}
      className="ua-select"
    >
      <option value=""> </option>
      {choices.route.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function storedVital(row: BoardSnapshot["vitals"][number] | undefined, field: Exclude<keyof VitalDraft, "avpu">): string {
  if (!row) return "";
  if (field === "time") return formatHmm(row.measuredAt);
  if (field === "pulse") return row.pulseRate == null ? "" : String(row.pulseRate);
  if (field === "location") return row.pulseLocation ?? "";
  if (field === "systolic") return row.systolic == null ? "" : String(row.systolic);
  if (field === "diastolic") return row.diastolic == null ? "" : String(row.diastolic);
  if (field === "respiratory") return row.respiratoryRate == null ? "" : String(row.respiratoryRate);
  if (field === "spo2") return row.spo2 == null ? "" : String(row.spo2);
  if (field === "pain") return row.painScale == null ? "" : String(row.painScale);
  return "";
}

function avpuPaper(value: string): string {
  if (value === "ALERT") return "A - Alert";
  if (value === "VERBAL") return "V - Verbal";
  if (value === "PAIN") return "P - Pain";
  if (value === "UNRESPONSIVE") return "U - Unresponsive";
  return "";
}

function painPaper(value: string, options: readonly { value: string }[]): string {
  return options.find((option) => option.value.startsWith(`${value} `) || option.value === value)?.value ?? "";
}
