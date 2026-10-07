import {
  compareHlc,
  conflictNeedsReview,
  initialHlc,
  receiveHlc,
  type CasualtyCard,
  type Mutation,
  type MutationResult,
  type SyncConflictInfo,
} from "@tccc/shared";
import { getDeviceId, getLastPullSeq, getMeta, setLastPullSeq, setMeta } from "../db/meta";
import type { TcccDB } from "../db/schema";
import type { LocalConflict, OutboxMutation } from "../db/types";
import { isRetryableError, pullChanges, pushMutations } from "./api";
import { coalesceOutbox } from "./coalesce";
import { aggregateClock, rebaseCard } from "./rebase";

const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** How many pulled cards to apply before yielding so a catch-up can paint. */
const PULL_APPLY_CHUNK = 20;

export interface PushRetry {
  attempts: number;
  message: string;
}

function toMutation(entry: OutboxMutation): Mutation {
  const { seq: _seq, status: _status, attempts: _attempts, createdAt: _createdAt, lastError: _lastError, ...mutation } = entry;
  return mutation;
}

async function rememberServerTime(db: TcccDB, serverTime: string): Promise<void> {
  const serverMs = Date.parse(serverTime);
  if (Number.isNaN(serverMs)) return;
  const deviceId = await getDeviceId(db);
  const state = (await getMeta(db, "hlcState")) ?? initialHlc(deviceId);
  await setMeta(db, "hlcState", receiveHlc(state, { wallTime: serverMs, counter: 0, nodeId: "server" }, Date.now()));
  await setMeta(db, "serverClockOffsetMs", serverMs - Date.now());
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
  const now = new Date().toISOString();
  const rows: LocalConflict[] = [];
  for (const conflict of review) {
    if (seen.has(conflict.id)) continue;
    seen.add(conflict.id);
    rows.push({ ...conflict, cardId, createdAt: now, resolvedAt: null, open: 1 });
  }
  if (rows.length > 0) await db.conflicts.bulkPut(rows);
  return true;
}

const REBASE_TABLES = (db: TcccDB) => [db.casualties, db.outbox, db.conflicts] as const;

/**
 * Reads the still-queued outbox and writes the rebased card in the caller's
 * transaction. An incoming aggregate older than the stored row is ignored so a
 * stale pull cannot clobber a newer local card.
 */
async function commitRebase(db: TcccDB, server: CasualtyCard, conflict: boolean): Promise<boolean> {
  const stored = await db.casualties.get(server.id);
  if (stored && compareHlc(aggregateClock(server.fieldClock), stored.clientUpdatedAt) < 0) return false;

  const queued = await db.outbox.where("cardId").equals(server.id).and((entry) => entry.status === "queued").sortBy("seq");
  const openConflict = conflict || (await unresolvedConflict(db, server.id));
  const syncStatus = openConflict ? "conflict" : queued.length > 0 ? "pending" : "synced";
  await db.casualties.put(rebaseCard(server, queued, syncStatus));
  const seqs = queued.flatMap((entry) => (entry.seq == null ? [] : [entry.seq]));
  if (seqs.length > 0) {
    await db.outbox.where("seq").anyOf(seqs).modify((entry) => {
      entry.baseVersion = server.version;
    });
  }
  return true;
}

async function writeRebased(db: TcccDB, server: CasualtyCard, conflict: boolean): Promise<boolean> {
  return db.transaction("rw", REBASE_TABLES(db), () => commitRebase(db, server, conflict));
}

async function applyResults(db: TcccDB, results: MutationResult[]): Promise<void> {
  await db.transaction("rw", REBASE_TABLES(db), async () => {
    const servers = new Map<string, CasualtyCard>();
    const conflicts = new Map<string, boolean>();

    for (const result of results) {
      if (result.status === "rejected") {
        await db.outbox.where("mutationId").equals(result.mutationId).modify((entry) => {
          entry.status = "failed";
          entry.lastError = `${result.error.code}: ${result.error.message}`;
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
  });
}

/** Push queued mutations. `onRetry` runs after a network or 5xx failure. */
export async function pushOutbox(db: TcccDB, onRetry?: (retry: PushRetry) => void): Promise<"ok" | "retry"> {
  await db.outbox.where("status").equals("inflight").modify((entry) => {
    entry.status = "queued";
  });
  const queued = await db.outbox.where("status").equals("queued").sortBy("seq");
  const { mutations, deleteSeqs } = coalesceOutbox(queued);
  await db.transaction("rw", db.outbox, async () => {
    if (deleteSeqs.length > 0) await db.outbox.bulkDelete(deleteSeqs);
    if (mutations.length > 0) await db.outbox.bulkPut(mutations);
  });
  if (mutations.length === 0) return "ok";

  const deviceId = await getDeviceId(db);
  for (let offset = 0; offset < mutations.length; offset += 500) {
    const batch = mutations.slice(offset, offset + 500);
    const ids = batch.map((entry) => entry.mutationId);
    await db.outbox.where("mutationId").anyOf(ids).modify((entry) => {
      entry.status = "inflight";
    });

    try {
      const response = await pushMutations(deviceId, batch.map(toMutation));
      await rememberServerTime(db, response.serverTime);
      await applyResults(db, response.results);
    } catch (error) {
      if (!isRetryableError(error)) throw error;
      const message = error instanceof Error ? error.message : "Sync failed";
      await db.outbox.where("mutationId").anyOf(ids).modify((entry) => {
        entry.status = "queued";
        entry.attempts += 1;
        entry.lastError = message;
      });
      const attempts = Math.max(...batch.map((entry) => entry.attempts + 1));
      onRetry?.({ attempts, message });
      return "retry";
    }
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
      const wrote = await writeRebased(db, card, false);
      if (wrote) await purgeExpired(db, card);
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
  if (Number.isNaN(deletedMs) || Date.now() - deletedMs < DELETED_RETENTION_MS) return;
  const pending = await db.outbox.where("cardId").equals(card.id).count();
  if (pending === 0) await db.casualties.delete(card.id);
}
