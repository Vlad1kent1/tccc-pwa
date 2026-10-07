"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { casualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import type { Dd1380Values } from "@/components/pages/casualties/dd1380/form-context";
import { cardToValues } from "@/components/pages/casualties/dd1380/mapping";
import { persistForm, type SlotId } from "@/components/pages/casualties/dd1380/persist-form";

const DEBOUNCE_MS = 400;

export type SheetReaction = "adopt" | "ignore" | "conflict";

/** How an open sheet treats a live card. A clean sheet takes the pull. A dirty sheet does not. */
export function sheetReaction(input: {
  cardUpdatedAt: string;
  acked: string;
  basedOn: string;
  dirty: boolean;
}): SheetReaction {
  if (input.cardUpdatedAt === input.acked) return input.dirty ? "ignore" : "adopt";
  if (input.cardUpdatedAt === input.basedOn) return "ignore";
  if (!input.dirty) return "adopt";
  return "conflict";
}

export interface BoundDd1380 {
  values: Dd1380Values;
  onChange: (next: Dd1380Values) => void;
  /** A pull arrived while this sheet had unsaved edits. The sheet is left as the user left it. */
  remoteUpdate: boolean;
  keepMine: () => void;
  loadUpdated: () => void;
}

function sameValues(a: Dd1380Values, b: Dd1380Values): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function withSlots(values: Dd1380Values, assigned: SlotId[], cleared: SlotId[]): Dd1380Values {
  const next: Record<string, string | boolean> = { ...values };
  for (const slot of assigned) {
    if (!next[slot.key]) next[slot.key] = slot.id;
  }
  for (const slot of cleared) {
    if (next[slot.key] === slot.id) delete next[slot.key];
  }
  return next;
}

export function useBoundDd1380(card: LocalCasualtyCard): BoundDd1380 {
  const [values, setValues] = useState(() => cardToValues(card));
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const valuesRef = useRef(values);
  const epoch = useRef(0);
  const saving = useRef(false);
  const dirty = useRef(false);
  const conflict = useRef(false);
  const basedOn = useRef(card.clientUpdatedAt);
  const acked = useRef(card.clientUpdatedAt);
  const cardId = useRef(card.id);
  const incoming = useRef<LocalCasualtyCard | null>(null);
  const seenId = useRef(card.id);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  cardId.current = card.id;

  const adopt = useCallback((nextCard: LocalCasualtyCard) => {
    const next = cardToValues(nextCard);
    basedOn.current = nextCard.clientUpdatedAt;
    acked.current = nextCard.clientUpdatedAt;
    dirty.current = false;
    conflict.current = false;
    incoming.current = null;
    setRemoteUpdate(false);
    if (!sameValues(valuesRef.current, next)) {
      valuesRef.current = next;
      setValues(next);
    }
  }, []);

  useEffect(() => {
    if (seenId.current !== card.id) {
      seenId.current = card.id;
      epoch.current += 1;
      clearTimeout(timer.current);
      adopt(card);
      return;
    }
    const reaction = sheetReaction({
      cardUpdatedAt: card.clientUpdatedAt,
      acked: acked.current,
      basedOn: basedOn.current,
      dirty: dirty.current,
    });
    if (reaction === "adopt" && !conflict.current) {
      adopt(card);
      return;
    }
    if (reaction !== "conflict") return;
    incoming.current = card;
    conflict.current = true;
    setRemoteUpdate(true);
    clearTimeout(timer.current);
  }, [adopt, card]);

  useEffect(() => () => {
    clearTimeout(timer.current);
  }, []);

  const flush = useCallback(async () => {
    if (conflict.current || saving.current || !dirty.current) return;
    const token = epoch.current;
    const snapshot = valuesRef.current;
    const id = cardId.current;
    saving.current = true;
    try {
      const outcome = await persistForm(casualtyRepo, id, snapshot, () => token === epoch.current && !conflict.current);
      if (outcome.status === "saved") {
        acked.current = outcome.clientUpdatedAt;
        basedOn.current = outcome.clientUpdatedAt;
        const merged = withSlots(valuesRef.current, outcome.assigned, outcome.cleared);
        if (!sameValues(valuesRef.current, merged)) {
          valuesRef.current = merged;
          setValues(merged);
        }
        if (token === epoch.current) dirty.current = false;
      }
    } catch (error) {
      console.error("DD1380 save failed", error);
    } finally {
      saving.current = false;
      if (!conflict.current && epoch.current !== token) void flush();
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, DEBOUNCE_MS);
  }, [flush]);

  const onChange = useCallback((next: Dd1380Values) => {
    valuesRef.current = next;
    dirty.current = true;
    epoch.current += 1;
    setValues(next);
    if (!conflict.current) schedule();
  }, [schedule]);

  const keepMine = useCallback(() => {
    const nextCard = incoming.current;
    conflict.current = false;
    incoming.current = null;
    setRemoteUpdate(false);
    if (nextCard) basedOn.current = nextCard.clientUpdatedAt;
    dirty.current = true;
    epoch.current += 1;
    if (!saving.current) void flush();
  }, [flush]);

  const loadUpdated = useCallback(() => {
    const nextCard = incoming.current;
    if (!nextCard) return;
    epoch.current += 1;
    clearTimeout(timer.current);
    adopt(nextCard);
  }, [adopt]);

  return { values, onChange, remoteUpdate, keepMine, loadUpdated };
}
