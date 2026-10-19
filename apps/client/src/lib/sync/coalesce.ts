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

type CardUpsert = Extract<OutboxMutation, { op: "card.upsert" }>;

/**
 * Merges queued patches of one card. Each field keeps the value of its newest
 * edit and that edit's clock, so fields last edited by the same entry travel
 * together, one mutation per entry. One clock for all fields would make an older
 * edit look as new as the latest, and the server would let it overwrite another
 * device's newer value. The first mutation takes the earliest position, so the
 * card still reaches the server before its child rows.
 */
function coalesceCardUpserts(upserts: CardUpsert[]): OutboxMutation[] {
  const ordered = [...upserts].sort((a, b) => anchorSeq(a) - anchorSeq(b));
  const first = ordered[0]!;
  const winners = new Map<CardField, CardUpsert>();
  for (const entry of ordered) {
    for (const field of entry.changedFields) {
      const current = winners.get(field);
      if (!current || later(entry.hlc, current.hlc)) winners.set(field, entry);
    }
  }

  const fieldsByEntry = new Map<CardUpsert, CardField[]>();
  for (const [field, entry] of winners) fieldsByEntry.set(entry, [...(fieldsByEntry.get(entry) ?? []), field]);
  const attempts = Math.max(...ordered.map((entry) => entry.attempts));

  return [...fieldsByEntry]
    .sort(([a], [b]) => anchorSeq(a) - anchorSeq(b))
    .map(([entry, fields], index) => ({
      ...entry,
      seq: index === 0 ? first.seq : entry.seq,
      createdAt: index === 0 ? first.createdAt : entry.createdAt,
      baseVersion: first.baseVersion,
      patch: Object.fromEntries(fields.map((field) => [field, entry.patch[field]])),
      changedFields: fields,
      attempts,
      status: "queued",
      lastError: undefined,
    }));
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
  const upserts = entries.filter((entry): entry is CardUpsert => entry.op === "card.upsert");
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
  if (upserts.length > 0) result.push(...coalesceCardUpserts(upserts));
  for (const group of children.values()) result.push(winningChild(group));
  if (deletes.length > 0) result.push(winningChild(deletes));
  return result.sort((a, b) => anchorSeq(a) - anchorSeq(b));
}

/**
 * Merges queued mutations for the same card and entity. The highest HLC wins a
 * field, and keeps its own clock. Failed and in-flight rows are left untouched.
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
