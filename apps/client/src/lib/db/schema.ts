import Dexie, { type EntityTable } from "dexie";
import type { LocalCasualtyCard, LocalConflict, MetaEntry, OutboxMutation } from "./types";

export const DB_NAME = "tccc";

/** Indexed flag. IndexedDB skips `null`, so presence is stored as 1 or 0. */
export type IndexFlag = 0 | 1;

export function activeFlag(deletedAt: string | null | undefined): IndexFlag {
  return deletedAt == null ? 1 : 0;
}

export function openFlag(resolvedAt: string | null | undefined): IndexFlag {
  return resolvedAt == null ? 1 : 0;
}

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
    this.version(2)
      .stores({
        casualties:
          "id, evacPriority, syncStatus, clientUpdatedAt, deletedAt, active, battleRosterNumber, [lastName+firstName]",
        outbox: "++seq, &mutationId, cardId, status, createdAt",
        conflicts: "id, cardId, resolvedAt, open, [cardId+open]",
        meta: "key",
      })
      .upgrade(async (tx) => {
        await tx.table("casualties").toCollection().modify((card: { deletedAt?: string | null; active?: IndexFlag }) => {
          card.active = activeFlag(card.deletedAt);
        });
        await tx.table("conflicts").toCollection().modify((row: { resolvedAt?: string | null; open?: IndexFlag }) => {
          row.open = openFlag(row.resolvedAt);
        });
      });

    this.casualties.hook("creating", (_key, obj) => {
      obj.active = activeFlag(obj.deletedAt);
    });
    this.casualties.hook("updating", (mods, _key, obj) => {
      const deletedAt = "deletedAt" in mods ? (mods as { deletedAt?: string | null }).deletedAt : obj.deletedAt;
      return { active: activeFlag(deletedAt) };
    });
    this.conflicts.hook("creating", (_key, obj) => {
      obj.open = openFlag(obj.resolvedAt);
    });
    this.conflicts.hook("updating", (mods, _key, obj) => {
      const resolvedAt = "resolvedAt" in mods ? (mods as { resolvedAt?: string | null }).resolvedAt : obj.resolvedAt;
      return { open: openFlag(resolvedAt) };
    });
  }
}

export const db = new TcccDB();
