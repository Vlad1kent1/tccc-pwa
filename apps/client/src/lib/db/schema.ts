import Dexie, { type EntityTable } from "dexie";
import type { LocalCasualtyCard, LocalConflict, MetaEntry, OutboxMutation } from "./types";

export const DB_NAME = "tccc";

// Migration policy: every schema change is a new this.version(n).stores(...).upgrade(...).
// Existing versions are never edited, because installed clients already ran them.
export class TcccDB extends Dexie {
  casualties!: EntityTable<LocalCasualtyCard, "id">;
  outbox!: EntityTable<OutboxMutation, "seq">;
  conflicts!: EntityTable<LocalConflict, "id">;
  meta!: EntityTable<MetaEntry, "key">;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      casualties: "id, evacPriority, syncStatus, clientUpdatedAt, deletedAt, battleRosterNumber, [lastName+firstName]",
      outbox: "++seq, &mutationId, cardId, status, createdAt",
      conflicts: "id, cardId, resolvedAt",
      meta: "key", // deviceId, lastPullSeq, hlcState, responderProfile, locale, persistenceRequested
    });
  }
}

export const db = new TcccDB();
