import {
  initialHlc,
  newId,
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
import { rebaseCard } from "./rebase";

const CRITICAL_CARD_FIELDS = new Set(["evacPriority", "allergies"]);
const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface PushRetry {
  attempts: number;
  message: string;
}

function isCritical(conflict: SyncConflictInfo): boolean {
  if (conflict.entity === "tourniquet") return true;
  return conflict.entity === "card" && CRITICAL_CARD_FIELDS.has(conflict.field);
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

async function unresolvedConflict(db: TcccDB, cardId: string): Promise<boolean> {
  const count = await db.conflicts.filter((conflict) => conflict.cardId === cardId && conflict.resolvedAt == null).count();
  return count > 0;
}

async function copyCriticalConflicts(db: TcccDB, cardId: string, conflicts: SyncConflictInfo[]): Promise<boolean> {
  const critical = conflicts.filter(isCritical);
  if (critical.length === 0) return unresolvedConflict(db, cardId);

  const existing = await db.conflicts.where("cardId").equals(cardId).toArray();
  const seen = new Set(
    existing.filter((conflict) => conflict.resolvedAt == null).map((conflict) => `${conflict.entity}:${conflict.entityId}:${conflict.field}`),
  );
  const now = new Date().toISOString();
  const rows: LocalConflict[] = [];
  for (const conflict of critical) {
    const key = `${conflict.entity}:${conflict.entityId}:${conflict.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...conflict, id: newId(), cardId, createdAt: now, resolvedAt: null });
  }
  if (rows.length > 0) await db.conflicts.bulkAdd(rows);
  return true;
}

async function writeRebased(db: TcccDB, server: CasualtyCard, conflict: boolean): Promise<void> {
  const queued = await db.outbox.where("cardId").equals(server.id).and((entry) => entry.status === "queued").sortBy("seq");
  const syncStatus = conflict ? "conflict" : queued.length > 0 ? "pending" : "synced";
  await db.casualties.put(rebaseCard(server, queued, syncStatus));
  if (queued.length > 0) {
    await db.outbox.where("cardId").equals(server.id).and((entry) => entry.status === "queued").modify((entry) => {
      entry.baseVersion = server.version;
    });
  }
}

async function applyResults(db: TcccDB, results: MutationResult[]): Promise<void> {
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
    const critical = result.status === "merged" ? await copyCriticalConflicts(db, result.card.id, result.conflicts) : false;
    conflicts.set(result.card.id, (conflicts.get(result.card.id) ?? false) || critical);
  }

  for (const [cardId, server] of servers) {
    const critical = conflicts.get(cardId) || (await unresolvedConflict(db, cardId));
    await writeRebased(db, server, critical);
  }
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
    for (const card of page.cards) {
      const critical = await unresolvedConflict(db, card.id);
      await writeRebased(db, card, critical);
      await purgeExpired(db, card);
    }
    since = page.nextSince;
    await setLastPullSeq(db, since);
    hasMore = page.hasMore;
  }
}

async function purgeExpired(db: TcccDB, card: CasualtyCard): Promise<void> {
  if (!card.deletedAt) return;
  const deletedMs = Date.parse(card.deletedAt);
  if (Number.isNaN(deletedMs) || Date.now() - deletedMs < DELETED_RETENTION_MS) return;
  const pending = await db.outbox.where("cardId").equals(card.id).count();
  if (pending === 0) await db.casualties.delete(card.id);
}
