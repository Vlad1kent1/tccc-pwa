import {
  conflictNeedsReview,
  initialHlc,
  receiveHlc,
  type CasualtyCard,
  type Mutation,
  type MutationResult,
  type SyncConflictInfo,
} from "@tccc/shared";
import {
  getDeviceId,
  getLastPullSeq,
  getMeta,
  nextHlc,
  observeClock,
  rememberServerClock,
  setLastPullSeq,
  setMeta,
} from "../db/meta";
import type { TcccDB } from "../db/schema";
import type { LocalConflict, OutboxMutation } from "../db/types";
import { getNetworkAdjustedTime, networkNowIso } from "../network-clock";
import { ApiError, isRetryableError, pullChanges, pushMutations } from "./api";
import { coalesceOutbox } from "./coalesce";
import { newestClock, rebaseCard, sameCardContent, sameRecord } from "./rebase";

const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** How many pulled cards to apply before yielding so a catch-up can paint. */
const PULL_APPLY_CHUNK = 20;
/** Mutations per push request. A mass-casualty backlog is sent in many small requests. */
export const MAX_PUSH_MUTATIONS = 50;
/**
 * JSON bytes of mutations per push request. Express rejects bodies over 100 kB by
 * default; this leaves room for the request envelope.
 */
export const MAX_PUSH_BYTES = 64 * 1024;

export interface PushRetry {
  attempts: number;
  message: string;
  /** HTTP status when the server answered. */
  status?: number | null;
}

/** A mutation the server could not apply this time (`INTERNAL`), left queued for a later push. */
interface Deferred {
  attempts: number;
  message: string;
}

function toMutation(entry: OutboxMutation): Mutation {
  const { seq: _seq, status: _status, attempts: _attempts, createdAt: _createdAt, lastError: _lastError, ...mutation } = entry;
  return mutation;
}

const encoder = new TextEncoder();

/** UTF-8 size of a value as JSON. Cyrillic text takes two bytes a character. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Splits mutations, in order, into requests of at most `maxCount` mutations and
 * `maxBytes` bytes. A mutation larger than `maxBytes` goes alone.
 */
export function chunkMutations<T>(
  entries: readonly T[],
  size: (entry: T) => number,
  limits: { maxCount: number; maxBytes: number } = { maxCount: MAX_PUSH_MUTATIONS, maxBytes: MAX_PUSH_BYTES },
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const entryBytes = size(entry);
    if (current.length > 0 && (current.length >= limits.maxCount || bytes + entryBytes > limits.maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entryBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function rememberServerTime(db: TcccDB, serverTime: string): Promise<void> {
  const serverMs = Date.parse(serverTime);
  if (Number.isNaN(serverMs)) return;
  await db.transaction("rw", db.meta, async () => {
    await rememberServerClock(db, serverMs);
    const deviceId = await getDeviceId(db);
    const state = (await getMeta(db, "hlcState")) ?? initialHlc(deviceId);
    await setMeta(db, "hlcState", receiveHlc(state, { wallTime: serverMs, counter: 0, nodeId: "server" }, getNetworkAdjustedTime()));
  });
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function unresolvedConflict(db: TcccDB, cardId: string): Promise<boolean> {
  const count = await db.conflicts.where("[cardId+open]").equals([cardId, 1]).count();
  return count > 0;
}

/** Stores review conflicts returned by this device's push, using the server row id. */
async function copyReviewConflicts(db: TcccDB, cardId: string, conflicts: SyncConflictInfo[]): Promise<boolean> {
  const review = conflicts.filter(conflictNeedsReview);
  if (review.length === 0) return unresolvedConflict(db, cardId);

  const existing = await db.conflicts.where("[cardId+open]").equals([cardId, 1]).toArray();
  const seen = new Set(existing.map((conflict) => conflict.id));
  const now = networkNowIso();
  const rows: LocalConflict[] = [];
  for (const conflict of review) {
    if (seen.has(conflict.id)) continue;
    seen.add(conflict.id);
    rows.push({ ...conflict, cardId, createdAt: now, resolvedAt: null, open: 1 });
  }
  if (rows.length > 0) await db.conflicts.bulkPut(rows);
  return true;
}

const REBASE_TABLES = (db: TcccDB) => [db.casualties, db.outbox, db.conflicts, db.meta] as const;

/** Outbox entries of a card that are not yet acknowledged, oldest first. */
function unsent(db: TcccDB, cardId: string): Promise<OutboxMutation[]> {
  return db.outbox
    .where("cardId")
    .equals(cardId)
    .and((entry) => entry.status === "queued" || entry.status === "inflight")
    .sortBy("seq");
}

async function hasFailed(db: TcccDB, cardId: string): Promise<boolean> {
  return (await db.outbox.where("cardId").equals(cardId).and((entry) => entry.status === "failed").count()) > 0;
}

/**
 * Merges a server aggregate into the stored card in the caller's transaction:
 * field by field and row by row by clock, then the still-queued edits on top
 * (see `rebaseCard`). A card whose content changed gets a fresh local clock, so
 * open screens and the list treat it as the newest change even when the edit it
 * carries is older than this device's own last edit. Server metadata never moves
 * back to an older version.
 */
async function commitRebase(db: TcccDB, server: CasualtyCard, conflict: boolean): Promise<void> {
  const stored = await db.casualties.get(server.id);
  const queued = await unsent(db, server.id);
  const openConflict = conflict || (await unresolvedConflict(db, server.id));
  const syncStatus = openConflict ? "conflict" : queued.length > 0 || (await hasFailed(db, server.id)) ? "pending" : "synced";
  const merged = rebaseCard(server, queued, syncStatus, stored);

  const stale = stored?.serverVersion != null && server.version < stored.serverVersion;
  if (stored && stale) {
    merged.serverVersion = stored.serverVersion;
    merged.changeSeq = stored.changeSeq;
    merged.serverUpdatedAt = stored.serverUpdatedAt;
  }

  // Edits made after seeing this card must be newer than every clock on it.
  const now = getNetworkAdjustedTime();
  await observeClock(db, newestClock(server), now);
  if (stored && !sameCardContent(merged, stored)) merged.clientUpdatedAt = await nextHlc(db, now);
  if (!stored || !sameRecord(merged, stored)) await db.casualties.put(merged);

  const seqs = queued.flatMap((entry) => (entry.seq == null ? [] : [entry.seq]));
  if (seqs.length > 0 && !stale) {
    await db.outbox.where("seq").anyOf(seqs).modify((entry) => {
      entry.baseVersion = server.version;
    });
  }
}

async function writeRebased(db: TcccDB, server: CasualtyCard, conflict: boolean): Promise<void> {
  await db.transaction("rw", REBASE_TABLES(db), () => commitRebase(db, server, conflict));
}

/**
 * A delete the server answers NOT_FOUND has nothing left to do: the row, or the
 * card, is not on the server. A row added and deleted offline coalesces into such
 * a delete; treating it as a failure would stall it forever.
 */
function alreadyGone(entry: OutboxMutation | undefined, result: Extract<MutationResult, { status: "rejected" }>): boolean {
  return result.error.code === "NOT_FOUND" && (entry?.op === "child.delete" || entry?.op === "card.delete");
}

/** Marks a card synced once nothing of it is waiting, when no server copy came back to rebase on. */
async function settleStatus(db: TcccDB, cardId: string): Promise<void> {
  const card = await db.casualties.get(cardId);
  if (!card || card.syncStatus !== "pending") return;
  if ((await unsent(db, cardId)).length > 0 || (await hasFailed(db, cardId)) || (await unresolvedConflict(db, cardId))) return;
  await db.casualties.put({ ...card, syncStatus: "synced" });
}

/**
 * Applies a push response. A mutation rejected for its data is marked failed; one the server
 * failed to apply (`INTERNAL`) goes back to the queue and is returned, so the caller retries it
 * after a backoff while the rest of the outbox keeps moving.
 */
async function applyResults(db: TcccDB, results: MutationResult[], batch: OutboxMutation[]): Promise<Deferred[]> {
  const sent = new Map(batch.map((entry) => [entry.mutationId, entry]));
  const deferred: Deferred[] = [];
  await db.transaction("rw", REBASE_TABLES(db), async () => {
    const servers = new Map<string, CasualtyCard>();
    const conflicts = new Map<string, boolean>();
    const settled = new Set<string>();

    for (const result of results) {
      if (result.status === "rejected") {
        const entry = sent.get(result.mutationId);
        if (alreadyGone(entry, result)) {
          await db.outbox.where("mutationId").equals(result.mutationId).delete();
          settled.add(entry!.cardId);
          continue;
        }
        const lastError = `${result.error.code}: ${result.error.message}`;
        if (result.error.code === "INTERNAL") {
          await db.outbox.where("mutationId").equals(result.mutationId).modify((row) => {
            row.status = "queued";
            row.attempts += 1;
            row.lastError = lastError;
          });
          deferred.push({ attempts: (entry?.attempts ?? 0) + 1, message: lastError });
          continue;
        }
        await db.outbox.where("mutationId").equals(result.mutationId).modify((row) => {
          row.status = "failed";
          row.lastError = lastError;
        });
        continue;
      }

      await db.outbox.where("mutationId").equals(result.mutationId).delete();
      servers.set(result.card.id, result.card);
      const critical = result.status === "merged" ? await copyReviewConflicts(db, result.card.id, result.conflicts) : false;
      conflicts.set(result.card.id, (conflicts.get(result.card.id) ?? false) || critical);
    }

    for (const [cardId, server] of servers) {
      const critical = conflicts.get(cardId) || (await unresolvedConflict(db, cardId));
      await commitRebase(db, server, critical);
    }
    for (const cardId of settled) {
      if (!servers.has(cardId)) await settleStatus(db, cardId);
    }
  });
  return deferred;
}

function setStatus(db: TcccDB, batch: OutboxMutation[], status: OutboxMutation["status"]): Promise<number> {
  return db.outbox
    .where("mutationId")
    .anyOf(batch.map((entry) => entry.mutationId))
    .modify((entry) => {
      entry.status = status;
    });
}

function isTooLarge(error: unknown): boolean {
  return error instanceof ApiError && error.status === 413;
}

/**
 * Pushes queued mutations in requests of at most `MAX_PUSH_MUTATIONS` and
 * `MAX_PUSH_BYTES`. A request the server still refuses as too large (413) is
 * halved and retried; a single mutation that is too large on its own is marked
 * failed so the rest of the outbox keeps moving. `onRetry` runs after a network or
 * 5xx failure (`"retry"`: the push stopped) and when the server answered but could not apply
 * some mutations (`"partial"`: those wait in the queue, everything else went through).
 */
export async function pushOutbox(
  db: TcccDB,
  onRetry?: (retry: PushRetry) => void,
): Promise<"ok" | "partial" | "retry"> {
  // Reading, merging, and rewriting the outbox is one step: nothing may change it in between.
  const mutations = await db.transaction("rw", db.outbox, async () => {
    await db.outbox.where("status").equals("inflight").modify((entry) => {
      entry.status = "queued";
    });
    const queued = await db.outbox.where("status").equals("queued").sortBy("seq");
    const { mutations: merged, deleteSeqs } = coalesceOutbox(queued);
    if (deleteSeqs.length > 0) await db.outbox.bulkDelete(deleteSeqs);
    if (merged.length > 0) await db.outbox.bulkPut(merged);
    return merged;
  });
  if (mutations.length === 0) return "ok";

  const deviceId = await getDeviceId(db);
  // A stack of requests, next on top; a halved request puts both halves back in order.
  const pending = chunkMutations(mutations, (entry) => jsonBytes(toMutation(entry))).reverse();
  const deferred: Deferred[] = [];
  while (pending.length > 0) {
    const batch = pending.pop()!;
    await setStatus(db, batch, "inflight");

    try {
      const response = await pushMutations(deviceId, batch.map(toMutation));
      await rememberServerTime(db, response.serverTime);
      deferred.push(...(await applyResults(db, response.results, batch)));
    } catch (error) {
      if (isTooLarge(error)) {
        await setStatus(db, batch, "queued");
        if (batch.length > 1) {
          const middle = Math.ceil(batch.length / 2);
          pending.push(batch.slice(middle), batch.slice(0, middle));
          continue;
        }
        await db.outbox.where("mutationId").equals(batch[0]!.mutationId).modify((entry) => {
          entry.status = "failed";
          entry.attempts += 1;
          entry.lastError = "TOO_LARGE: the server refused this change as too large (413)";
        });
        continue;
      }
      if (!isRetryableError(error)) {
        // The server refused the whole request (e.g. a 401 for the unit token), so nothing
        // was applied: back to queued, without counting an attempt.
        if (error instanceof ApiError) await setStatus(db, batch, "queued");
        throw error;
      }
      const message = error instanceof Error ? error.message : "Sync failed";
      await db.outbox.where("mutationId").anyOf(batch.map((entry) => entry.mutationId)).modify((entry) => {
        entry.status = "queued";
        entry.attempts += 1;
        entry.lastError = message;
      });
      const attempts = Math.max(...batch.map((entry) => entry.attempts + 1));
      onRetry?.({ attempts, message, status: error instanceof ApiError ? error.status : null });
      return "retry";
    }
  }
  if (deferred.length > 0) {
    onRetry?.({ attempts: Math.max(...deferred.map((item) => item.attempts)), message: deferred[0]!.message });
    return "partial";
  }
  return "ok";
}

export async function pullAll(db: TcccDB): Promise<void> {
  let since = await getLastPullSeq(db);
  let hasMore = true;
  while (hasMore) {
    const page = await pullChanges(since);
    await rememberServerTime(db, page.serverTime);
    for (let index = 0; index < page.cards.length; index += 1) {
      const card = page.cards[index]!;
      await writeRebased(db, card, false);
      await purgeExpired(db, card);
      const moreInPage = index + 1 < page.cards.length;
      if (moreInPage && (index + 1) % PULL_APPLY_CHUNK === 0) await yieldToMainThread();
    }
    since = page.nextSince;
    await setLastPullSeq(db, since);
    hasMore = page.hasMore;
    if (hasMore) await yieldToMainThread();
  }
}

async function purgeExpired(db: TcccDB, card: CasualtyCard): Promise<void> {
  if (!card.deletedAt) return;
  const deletedMs = Date.parse(card.deletedAt);
  if (Number.isNaN(deletedMs) || getNetworkAdjustedTime() - deletedMs < DELETED_RETENTION_MS) return;
  const pending = await db.outbox.where("cardId").equals(card.id).count();
  if (pending === 0) await db.casualties.delete(card.id);
}
