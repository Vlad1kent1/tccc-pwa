import {
  newId,
  type Avpu as AvpuName,
  type FluidKind as FluidKindName,
  type MedicationCategory as MedicationCategoryName,
  type Route as RouteName,
} from "@tccc/shared";
import { lastTimeToken, timeTokenToIso } from "@/lib/forms/time";
import { networkNowIso } from "@/lib/network-clock";
import { boundedInt } from "@/components/pages/casualties/board/entry";
import { fluidColumn, medicationColumn, vitalColumn } from "@/components/pages/casualties/board/paper-layout";
import type { BoardStore } from "@/components/pages/casualties/board/store";
import type { BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

type Vital = BoardSnapshot["vitals"][number];
type Fluid = BoardSnapshot["fluids"][number];
type Medication = BoardSnapshot["medications"][number];

export interface VitalDraft {
  time: string;
  pulse: string;
  location: string;
  systolic: string;
  diastolic: string;
  respiratory: string;
  spo2: string;
  avpu: AvpuName | null;
  pain: string;
}

export interface FluidDraft {
  name: string;
  volume: string;
  route: RouteName | "";
  time: string;
}

export interface MedicationDraft {
  name: string;
  dose: string;
  route: RouteName | "";
  time: string;
}

/** The row shown in a printed column, by the id pinned to it. */
export function paperRow<T extends { id: string }>(board: BoardSnapshot, rows: readonly T[], column: string): T | undefined {
  const id = board.paper.slots[column];
  return id ? rows.find((row) => row.id === id) : undefined;
}

/**
 * The row id for a keystroke in a printed column. An empty column gets a new row,
 * pinned to that column at once, so the next keystroke edits the same row.
 */
function rowForColumn(store: BoardStore, column: string): string {
  const pinned = store.getSnapshot().paper.slots[column];
  if (pinned) return pinned;
  const id = newId();
  store.pinPaperSlot(column, id);
  return id;
}

/** A typed time, placed against the value it corrects and the injury time. */
function typedTime(store: BoardStore, text: string, existing: string | null | undefined): string | null {
  return timeTokenToIso(lastTimeToken(text), { near: existing, notBefore: store.getSnapshot().identity.injuredAt });
}

function blank(value: string): boolean {
  return value.trim() === "";
}

function keepDraft(row: Record<string, string>, field: string, value: string, canonical: string): void {
  if (value.trim() !== "" && value !== canonical) row[field] = value;
  else delete row[field];
}

function writeDrafts(store: BoardStore, id: string, row: Record<string, string>): void {
  const current = store.getSnapshot().rowDrafts;
  if (Object.keys(row).length === 0 && !current[id]) return;
  if (JSON.stringify(current[id] ?? {}) === JSON.stringify(row)) return;
  const drafts = { ...current };
  if (Object.keys(row).length === 0) delete drafts[id];
  else drafts[id] = row;
  store.editRowDrafts(drafts);
}

function forgetDrafts(store: BoardStore, id: string): void {
  if (!store.getSnapshot().rowDrafts[id]) return;
  const drafts = { ...store.getSnapshot().rowDrafts };
  delete drafts[id];
  store.editRowDrafts(drafts);
}

export function saveVitalFields(store: BoardStore, id: string, draft: VitalDraft): void {
  const existing = store.getSnapshot().vitals.find((row) => row.id === id);
  const pulseRate = boundedInt(draft.pulse, 0, 300);
  const systolic = boundedInt(draft.systolic, 0, 300);
  const diastolic = boundedInt(draft.diastolic, 0, 200);
  const respiratoryRate = boundedInt(draft.respiratory, 0, 80);
  const spo2 = boundedInt(draft.spo2, 0, 100);
  const location = draft.location.trim().slice(0, 30);
  const pain = boundedInt(draft.pain, 0, 10);
  const empty = [draft.time, draft.pulse, draft.location, draft.systolic, draft.diastolic, draft.respiratory, draft.spo2, draft.pain].every(blank) && draft.avpu == null;
  if (empty) {
    if (existing) store.removeVital(id);
    forgetDrafts(store, id);
    return;
  }
  const bpInvalid = systolic != null && diastolic != null && systolic < diastolic;
  // A vitals set needs a time; one recorded without a typed time is taken now.
  const measuredAt = typedTime(store, draft.time, existing?.measuredAt) ?? existing?.measuredAt ?? networkNowIso();
  const row: Vital = {
    id,
    measuredAt,
    pulseRate: pulseRate === undefined ? (existing?.pulseRate ?? null) : pulseRate,
    pulseLocation: location || null,
    systolic: bpInvalid || systolic === undefined ? (existing?.systolic ?? null) : systolic,
    diastolic: bpInvalid || diastolic === undefined ? (existing?.diastolic ?? null) : diastolic,
    respiratoryRate: respiratoryRate === undefined ? (existing?.respiratoryRate ?? null) : respiratoryRate,
    spo2: spo2 === undefined ? (existing?.spo2 ?? null) : spo2,
    avpu: draft.avpu,
    painScale: pain === undefined ? (existing?.painScale ?? null) : pain,
    clientUpdatedAt: existing?.clientUpdatedAt ?? "",
    deletedAt: null,
  };
  store.upsertVital(row);
  const kept = { ...(store.getSnapshot().rowDrafts[id] ?? {}) };
  keepDraft(kept, "time", draft.time, "");
  keepDraft(kept, "pulse", draft.pulse, row.pulseRate == null ? "" : String(row.pulseRate));
  keepDraft(kept, "location", draft.location, row.pulseLocation ?? "");
  keepDraft(kept, "systolic", draft.systolic, row.systolic == null ? "" : String(row.systolic));
  keepDraft(kept, "diastolic", draft.diastolic, row.diastolic == null ? "" : String(row.diastolic));
  keepDraft(kept, "respiratory", draft.respiratory, row.respiratoryRate == null ? "" : String(row.respiratoryRate));
  keepDraft(kept, "spo2", draft.spo2, row.spo2 == null ? "" : String(row.spo2));
  keepDraft(kept, "pain", draft.pain, row.painScale == null ? "" : String(row.painScale));
  writeDrafts(store, id, kept);
}

export function saveFluidFields(store: BoardStore, id: string, kind: FluidKindName, draft: FluidDraft): void {
  const existing = store.getSnapshot().fluids.find((row) => row.id === id);
  const volumeMl = boundedInt(draft.volume, 1, 10000);
  const name = draft.name.trim().slice(0, 100);
  const empty = blank(draft.name) && blank(draft.volume) && !draft.route && blank(draft.time);
  if (empty) {
    if (existing) store.removeFluid(id);
    forgetDrafts(store, id);
    return;
  }
  const administeredAt = typedTime(store, draft.time, existing?.administeredAt) ?? existing?.administeredAt ?? null;
  const row: Fluid = {
    id,
    kind,
    name,
    volumeMl: volumeMl === undefined ? (existing?.volumeMl ?? null) : volumeMl,
    route: draft.route || null,
    administeredAt,
    clientUpdatedAt: existing?.clientUpdatedAt ?? "",
    deletedAt: null,
  };
  store.upsertFluid(row);
  const kept = { ...(store.getSnapshot().rowDrafts[id] ?? {}) };
  keepDraft(kept, "name", draft.name, row.name);
  keepDraft(kept, "volume", draft.volume, row.volumeMl == null ? "" : String(row.volumeMl));
  keepDraft(kept, "time", draft.time, "");
  writeDrafts(store, id, kept);
}

export function saveMedicationFields(store: BoardStore, id: string, category: MedicationCategoryName, draft: MedicationDraft): void {
  const existing = store.getSnapshot().medications.find((row) => row.id === id);
  const name = draft.name.trim().slice(0, 100);
  const dose = draft.dose.trim().slice(0, 50);
  const empty = blank(draft.name) && blank(draft.dose) && !draft.route && blank(draft.time);
  if (empty) {
    if (existing) store.removeMedication(id);
    forgetDrafts(store, id);
    return;
  }
  const administeredAt = typedTime(store, draft.time, existing?.administeredAt) ?? existing?.administeredAt ?? null;
  const row: Medication = {
    id,
    category,
    name,
    dose,
    route: draft.route || null,
    administeredAt,
    clientUpdatedAt: existing?.clientUpdatedAt ?? "",
    deletedAt: null,
  };
  store.upsertMedication(row);
  const kept = { ...(store.getSnapshot().rowDrafts[id] ?? {}) };
  keepDraft(kept, "name", draft.name, row.name);
  keepDraft(kept, "dose", draft.dose, row.dose);
  keepDraft(kept, "time", draft.time, "");
  writeDrafts(store, id, kept);
}

export function saveVitalSlot(store: BoardStore, index: number, patch: Partial<VitalDraft>): void {
  const id = rowForColumn(store, vitalColumn(index));
  const current = store.getSnapshot().vitals.find((row) => row.id === id);
  const drafts = store.getSnapshot().rowDrafts[id] ?? {};
  saveVitalFields(store, id, {
    time: patch.time ?? drafts.time ?? "",
    pulse: patch.pulse ?? drafts.pulse ?? (current?.pulseRate == null ? "" : String(current.pulseRate)),
    location: patch.location ?? drafts.location ?? current?.pulseLocation ?? "",
    systolic: patch.systolic ?? drafts.systolic ?? (current?.systolic == null ? "" : String(current.systolic)),
    diastolic: patch.diastolic ?? drafts.diastolic ?? (current?.diastolic == null ? "" : String(current.diastolic)),
    respiratory: patch.respiratory ?? drafts.respiratory ?? (current?.respiratoryRate == null ? "" : String(current.respiratoryRate)),
    spo2: patch.spo2 ?? drafts.spo2 ?? (current?.spo2 == null ? "" : String(current.spo2)),
    avpu: patch.avpu === undefined ? (current?.avpu ?? null) : patch.avpu,
    pain: patch.pain ?? drafts.pain ?? (current?.painScale == null ? "" : String(current.painScale)),
  });
}

export function saveFluidSlot(store: BoardStore, kind: FluidKindName, index: number, patch: Partial<FluidDraft>): void {
  const id = rowForColumn(store, fluidColumn(kind, index));
  const current = store.getSnapshot().fluids.find((row) => row.id === id);
  const drafts = store.getSnapshot().rowDrafts[id] ?? {};
  saveFluidFields(store, id, kind, {
    name: patch.name ?? drafts.name ?? current?.name ?? "",
    volume: patch.volume ?? drafts.volume ?? (current?.volumeMl == null ? "" : String(current.volumeMl)),
    route: patch.route ?? current?.route ?? "",
    time: patch.time ?? drafts.time ?? "",
  });
}

export function saveMedicationSlot(store: BoardStore, category: MedicationCategoryName, index: number, patch: Partial<MedicationDraft>): void {
  const id = rowForColumn(store, medicationColumn(category, index));
  const current = store.getSnapshot().medications.find((row) => row.id === id);
  const drafts = store.getSnapshot().rowDrafts[id] ?? {};
  saveMedicationFields(store, id, category, {
    name: patch.name ?? drafts.name ?? current?.name ?? "",
    dose: patch.dose ?? drafts.dose ?? current?.dose ?? "",
    route: patch.route ?? current?.route ?? "",
    time: patch.time ?? drafts.time ?? "",
  });
}
