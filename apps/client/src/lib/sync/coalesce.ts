import { compareHlc, type CardField } from "@tccc/shared";
import type { OutboxMutation } from "@/lib/db";

export interface CoalesceResult {
  /** Queued mutations to persist and send, in FIFO order. */
  mutations: OutboxMutation[];
  /** Primary keys of queued rows superseded by a merge. */
  deleteSeqs: number[];
}

function later(a: string, b: string): boolean {
  return compareHlc(a, b) >= 0;
}

function anchorSeq(entry: OutboxMutation): number {
  return entry.seq ?? Number.MAX_SAFE_INTEGER;
}

function coalesceCardUpserts(upserts: Extract<OutboxMutation, { op: "card.upsert" }>[]): OutboxMutation {
  const ordered = [...upserts].sort((a, b) => anchorSeq(a) - anchorSeq(b));
  const first = ordered[0]!;
  const fields = new Map<CardField, { value: unknown; hlc: string }>();

  for (const entry of ordered) {
    for (const field of entry.changedFields) {
      const current = fields.get(field);
      if (!current || later(entry.hlc, current.hlc)) {
        fields.set(field, { value: entry.patch[field], hlc: entry.hlc });
      }
    }
  }

  let winner = first;
  for (const entry of ordered) {
    if (later(entry.hlc, winner.hlc)) winner = entry;
  }

  const patch = Object.fromEntries([...fields].map(([field, value]) => [field, value.value]));
  return {
    ...winner,
    seq: first.seq,
    baseVersion: first.baseVersion,
    hlc: winner.hlc,
    patch,
    changedFields: [...fields.keys()],
    attempts: Math.max(...ordered.map((entry) => entry.attempts)),
    createdAt: first.createdAt,
    status: "queued",
    lastError: undefined,
  };
}

function childKey(entry: OutboxMutation): string | null {
  if (entry.op === "child.upsert") return `${entry.entity}:${entry.row.id}`;
  if (entry.op === "child.delete") return `${entry.entity}:${entry.entityId}`;
  return null;
}

function winningChild(entries: OutboxMutation[]): OutboxMutation {
  const ordered = [...entries].sort((a, b) => anchorSeq(a) - anchorSeq(b));
  let winner = ordered[0]!;
  for (const entry of ordered.slice(1)) {
    if (later(entry.hlc, winner.hlc)) winner = entry;
  }
  return { ...winner, seq: ordered[0]!.seq, baseVersion: ordered[0]!.baseVersion, status: "queued", lastError: undefined };
}

function coalesceCard(entries: OutboxMutation[]): OutboxMutation[] {
  const upserts = entries.filter((entry): entry is Extract<OutboxMutation, { op: "card.upsert" }> => entry.op === "card.upsert");
  const deletes = entries.filter((entry) => entry.op === "card.delete");
  const children = new Map<string, OutboxMutation[]>();

  for (const entry of entries) {
    const key = childKey(entry);
    if (!key) continue;
    const group = children.get(key) ?? [];
    group.push(entry);
    children.set(key, group);
  }

  const result: OutboxMutation[] = [];
  if (upserts.length > 0) result.push(coalesceCardUpserts(upserts));
  for (const group of children.values()) result.push(winningChild(group));
  if (deletes.length > 0) result.push(winningChild(deletes));
  return result.sort((a, b) => anchorSeq(a) - anchorSeq(b));
}

/**
 * Merges queued mutations for the same card and entity. Later patch fields
 * override earlier ones; the highest HLC wins a field when clocks disagree.
 * Failed and in-flight rows are left untouched.
 */
export function coalesceOutbox(entries: OutboxMutation[]): CoalesceResult {
  const queued = entries.filter((entry) => entry.status === "queued");
  const byCard = new Map<string, OutboxMutation[]>();
  for (const entry of queued) {
    const group = byCard.get(entry.cardId) ?? [];
    group.push(entry);
    byCard.set(entry.cardId, group);
  }

  const mutations = [...byCard.values()].flatMap(coalesceCard).sort((a, b) => anchorSeq(a) - anchorSeq(b));
  const kept = new Set(mutations.map((entry) => entry.seq));
  const deleteSeqs = queued
    .map((entry) => entry.seq)
    .filter((seq): seq is number => seq != null && !kept.has(seq));

  return { mutations, deleteSeqs };
}
