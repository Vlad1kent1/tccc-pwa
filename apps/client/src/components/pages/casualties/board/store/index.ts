"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  Limb,
  newId,
  type BodyRegion,
  type BodyView as BodyViewName,
  type CardPatch,
  type MechanismOfInjury,
} from "@tccc/shared";
import { casualtyRepo, db, getResponderProfile, type LocalCasualtyCard } from "@/lib/db";
import { responderPatch } from "@/lib/forms/values";
import type { InjurySite } from "@/components/pages/casualties/dd1380/injury-sites";
import { figureFor } from "@/components/pages/casualties/board/regions";
import { commitBoard } from "@/components/pages/casualties/board/commit";
import { EMPTY_SNAPSHOT, emptySnapshot, snapshotFromCard, type BoardSlice, type BoardSnapshot } from "@/components/pages/casualties/board/snapshot";

export type { BoardSlice, BoardSnapshot };

const listeners = new Set<() => void>();
const dirty = new Set<BoardSlice>();
const dirtyKeys = new Set<string>();
let snapshot: BoardSnapshot = EMPTY_SNAPSHOT;
let epoch = 0;
let saving = false;
let acked = "";
let heldAt: string | null = null;
let incoming: LocalCasualtyCard | null = null;
let creating: Promise<LocalCasualtyCard> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const idListeners = new Set<(id: string) => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBoard(): BoardSnapshot {
  return snapshot;
}

export function openSession(cardId: string | null): void {
  creating = null;
  dirty.clear();
  dirtyKeys.clear();
  incoming = null;
  heldAt = null;
  acked = "";
  epoch += 1;
  clearTimeout(timer);
  snapshot = emptySnapshot(cardId);
  emit();
}

export function hydrateBoard(card: LocalCasualtyCard): void {
  if (snapshot.cardId && card.id !== snapshot.cardId) {
    dirty.clear();
    dirtyKeys.clear();
    incoming = null;
    heldAt = null;
    acked = card.clientUpdatedAt;
    snapshot = snapshotFromCard(card);
    emit();
    return;
  }
  if (!snapshot.cardId) {
    acked = card.clientUpdatedAt;
    snapshot = mergeUndirty(snapshot, card);
    emit();
    return;
  }
  if (card.clientUpdatedAt === heldAt) return;
  if (card.clientUpdatedAt === acked || dirty.size === 0) {
    acked = card.clientUpdatedAt;
    heldAt = null;
    incoming = null;
    snapshot = mergeUndirty(snapshot, card);
    emit();
    return;
  }
  incoming = card;
  if (!snapshot.remote) {
    snapshot = { ...snapshot, remote: true };
    emit();
  }
}

function mergeUndirty(current: BoardSnapshot, card: LocalCasualtyCard): BoardSnapshot {
  const next = snapshotFromCard(card);
  return {
    ...next,
    remote: false,
    identity: dirty.has("identity") ? current.identity : next.identity,
    mechanism: dirty.has("mechanism") ? current.mechanism : next.mechanism,
    injuries: dirty.has("body") ? current.injuries : next.injuries,
    tourniquets: dirty.has("body") ? current.tourniquets : next.tourniquets,
    treatments: dirty.has("treatments") ? current.treatments : next.treatments,
    vitals: dirty.has("vitals") ? current.vitals : next.vitals,
    fluids: dirty.has("fluids") ? current.fluids : next.fluids,
    medications: dirty.has("meds") ? current.medications : next.medications,
    notes: dirty.has("notes") ? current.notes : next.notes,
    responder: dirty.has("responder") ? current.responder : next.responder,
  };
}

function touch(slice: BoardSlice, partial: Partial<BoardSnapshot>, keys: string[], when: "debounce" | "now"): void {
  epoch += 1;
  dirty.add(slice);
  for (const key of keys) dirtyKeys.add(key);
  snapshot = { ...snapshot, ...partial };
  emit();
  if (when === "now") {
    clearTimeout(timer);
    void flush();
  } else {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, 400);
  }
}

export function editIdentity(patch: Partial<BoardSnapshot["identity"]>, when: "debounce" | "now" = "debounce"): void {
  const immediate = !snapshot.cardId && Boolean(patch.lastName);
  touch("identity", { identity: { ...snapshot.identity, ...patch } }, Object.keys(patch), immediate ? "now" : when);
}

export function editMechanism(patch: Partial<BoardSnapshot["mechanism"]>, when: "debounce" | "now" = "now"): void {
  touch("mechanism", { mechanism: { ...snapshot.mechanism, ...patch } }, Object.keys(patch), when);
}

export function toggleMechanism(item: MechanismOfInjury): void {
  const has = snapshot.mechanism.mechanisms.includes(item);
  const mechanisms = has ? snapshot.mechanism.mechanisms.filter((entry) => entry !== item) : [...snapshot.mechanism.mechanisms, item];
  const mechanismOther = item === "OTHER" && has ? null : snapshot.mechanism.mechanismOther;
  editMechanism({ mechanisms, mechanismOther });
}

export function editTreatments(patch: Partial<BoardSnapshot["treatments"]>): void {
  touch("treatments", { treatments: { ...snapshot.treatments, ...patch } }, Object.keys(patch), "now");
}

export function toggleTreatment<K extends keyof BoardSnapshot["treatments"]>(key: K, item: BoardSnapshot["treatments"][K][number]): void {
  const current = snapshot.treatments[key] as string[];
  const next = current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item];
  editTreatments({ [key]: next } as Partial<BoardSnapshot["treatments"]>);
}

export function editNotes(notes: string): void {
  touch("notes", { notes: notes === "" ? null : notes }, ["notes"], "debounce");
}

export function editResponder(patch: Partial<BoardSnapshot["responder"]>): void {
  touch("responder", { responder: { ...snapshot.responder, ...patch } }, Object.keys(patch), "debounce");
}

export function toggleInjury(site: InjurySite, view: BodyViewName, region: BodyRegion): void {
  const existing = snapshot.injuries.find((row) => row.description === site.id);
  const injuries = existing ? snapshot.injuries.filter((row) => row.description !== site.id) : [...snapshot.injuries, injuryFromSite(site, view, region)];
  touch("body", { injuries }, [], "now");
}

export function setTourniquet(region: BodyRegion, type: string): void {
  const limb = limbFor(region);
  if (!limb) return;
  const tourniquets = type.trim()
    ? upsertTourniquet(limb, type.trim().slice(0, 50))
    : snapshot.tourniquets.filter((row) => row.limb !== limb);
  touch("body", { tourniquets }, [], "debounce");
}

export function upsertVital(row: BoardSnapshot["vitals"][number]): void {
  const vitals = snapshot.vitals.some((item) => item.id === row.id)
    ? snapshot.vitals.map((item) => (item.id === row.id ? row : item))
    : [...snapshot.vitals, row];
  touch("vitals", { vitals }, [], "now");
}

export function removeVital(id: string): void {
  touch("vitals", { vitals: snapshot.vitals.filter((row) => row.id !== id) }, [], "now");
}

export function upsertFluid(row: BoardSnapshot["fluids"][number]): void {
  const fluids = snapshot.fluids.some((item) => item.id === row.id)
    ? snapshot.fluids.map((item) => (item.id === row.id ? row : item))
    : [...snapshot.fluids, row];
  touch("fluids", { fluids }, [], "now");
}

export function removeFluid(id: string): void {
  touch("fluids", { fluids: snapshot.fluids.filter((row) => row.id !== id) }, [], "now");
}

export function upsertMedication(row: BoardSnapshot["medications"][number]): void {
  const medications = snapshot.medications.some((item) => item.id === row.id)
    ? snapshot.medications.map((item) => (item.id === row.id ? row : item))
    : [...snapshot.medications, row];
  touch("meds", { medications }, [], "now");
}

export function removeMedication(id: string): void {
  touch("meds", { medications: snapshot.medications.filter((row) => row.id !== id) }, [], "now");
}

export function keepBoardEdits(): void {
  if (incoming) heldAt = incoming.clientUpdatedAt;
  incoming = null;
  snapshot = { ...snapshot, remote: false };
  epoch += 1;
  emit();
  void flush();
}

export function loadBoardUpdate(): void {
  if (!incoming) return;
  dirty.clear();
  dirtyKeys.clear();
  acked = incoming.clientUpdatedAt;
  heldAt = null;
  snapshot = snapshotFromCard(incoming);
  incoming = null;
  epoch += 1;
  clearTimeout(timer);
  emit();
}

export function subscribeBoardId(listener: (id: string) => void): () => void {
  idListeners.add(listener);
  return () => idListeners.delete(listener);
}

export function flushBoard(): void {
  clearTimeout(timer);
  void flush();
}

export function useSlice<T>(select: (state: BoardSnapshot) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const cached = useRef<T>(select(EMPTY_SNAPSHOT));
  const get = useCallback(() => {
    const next = selectRef.current(snapshot);
    if (Object.is(cached.current, next)) return cached.current;
    cached.current = next;
    return next;
  }, []);
  const getServer = useCallback(() => {
    const next = selectRef.current(EMPTY_SNAPSHOT);
    if (Object.is(cached.current, next)) return cached.current;
    return next;
  }, []);
  return useSyncExternalStore(subscribe, get, getServer);
}

function currentPatch(): CardPatch {
  const sources: Record<string, unknown> = {
    ...snapshot.identity,
    ...snapshot.mechanism,
    ...snapshot.treatments,
    notes: snapshot.notes,
    responderName: snapshot.responder.responderName,
    responderLast4:
      snapshot.responder.responderLast4 == null || /^\d{4}$/.test(snapshot.responder.responderLast4)
        ? snapshot.responder.responderLast4
        : undefined,
  };
  const patch: Record<string, unknown> = {};
  for (const key of dirtyKeys) {
    if (sources[key] !== undefined) patch[key] = sources[key];
  }
  return patch as CardPatch;
}

async function flush(): Promise<void> {
  if (saving || dirty.size === 0) return;
  const token = epoch;
  const slices = new Set(dirty);
  saving = true;
  let failed = false;
  try {
    const id = await ensureCard(token);
    if (!id || token !== epoch) return;
    const outcome = await commitBoard(casualtyRepo, id, snapshot, slices, currentPatch(), () => token === epoch);
    if (outcome.status === "saved") {
      acked = outcome.clientUpdatedAt;
      heldAt = null;
      if (token === epoch) {
        for (const slice of slices) dirty.delete(slice);
        if (dirty.size === 0) dirtyKeys.clear();
        if (snapshot.remote) snapshot = { ...snapshot, remote: false };
      }
    }
  } catch (error) {
    failed = true;
    console.error("Board save failed", error);
  } finally {
    saving = false;
    if (!failed && epoch !== token && dirty.size > 0) void flush();
  }
}

async function ensureCard(_token: number): Promise<string | null> {
  if (snapshot.cardId) return snapshot.cardId;
  const name = snapshot.identity.lastName?.trim();
  if (!name) return null;
  if (!creating) {
    const initial = { ...snapshot.identity, lastName: name };
    creating = (async () => {
      const profile = await getResponderProfile(db);
      return casualtyRepo.create({ ...responderPatch(profile), ...initial });
    })();
  }
  let card: LocalCasualtyCard;
  try {
    card = await creating;
  } catch (error) {
    creating = null;
    throw error;
  }
  snapshot = {
    ...snapshot,
    cardId: card.id,
    responder: dirty.has("responder")
      ? snapshot.responder
      : { responderName: card.responderName, responderLast4: card.responderLast4 },
  };
  emit();
  announceCard(card.id);
  return card.id;
}

function announceCard(id: string): void {
  for (const listener of idListeners) listener(id);
  const url = `/casualties/new?id=${encodeURIComponent(id)}`;
  if (window.location.pathname === "/casualties/new") {
    window.history.replaceState(window.history.state, "", url);
  }
}

function injuryFromSite(site: InjurySite, view: BodyViewName, region: BodyRegion): BoardSnapshot["injuries"][number] {
  const figure = figureFor(view);
  return {
    id: newId(),
    cardId: snapshot.cardId ?? "00000000-0000-4000-8000-000000000000",
    region,
    view,
    x: clamp((site.x - figure.x0) / figure.w),
    y: clamp((site.y - figure.y0) / figure.h),
    description: site.id,
    clientUpdatedAt: "",
    deletedAt: null,
  };
}

function upsertTourniquet(limb: Limb, type: string): BoardSnapshot["tourniquets"] {
  const existing = snapshot.tourniquets.find((row) => row.limb === limb);
  const row = {
    id: existing?.id ?? newId(),
    cardId: snapshot.cardId ?? "00000000-0000-4000-8000-000000000000",
    limb,
    type,
    appliedAt: existing?.appliedAt ?? new Date().toISOString(),
    clientUpdatedAt: existing?.clientUpdatedAt ?? "",
    deletedAt: null,
  };
  return snapshot.tourniquets.some((item) => item.limb === limb)
    ? snapshot.tourniquets.map((item) => (item.limb === limb ? row : item))
    : [...snapshot.tourniquets, row];
}

function limbFor(region: BodyRegion): Limb | null {
  if (region === "RIGHT_ARM") return Limb.RIGHT_ARM;
  if (region === "LEFT_ARM") return Limb.LEFT_ARM;
  if (region === "RIGHT_LEG") return Limb.RIGHT_LEG;
  if (region === "LEFT_LEG") return Limb.LEFT_LEG;
  return null;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function limbForRegion(region: BodyRegion): Limb | null {
  return limbFor(region);
}
