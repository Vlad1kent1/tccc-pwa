import Dexie, { type EntityTable } from "dexie";
import { withSiteCode } from "./injury-site-code";
import { migrateLegacyExtras, readLegacyBag } from "./legacy-extras";
import type { LocalCasualtyCard, LocalConflict, MetaEntry, OutboxMutation } from "./types";

type LegacyInjury = { siteCode?: string | null; description?: string | null };

function isLegacyInjury(value: unknown): value is LegacyInjury {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

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
    // v3: paper-card details become card fields (no index change). The bag is read
    // here when this context has localStorage; see legacy-extras.ts.
    this.version(3)
      .stores({})
      .upgrade((tx) =>
        migrateLegacyExtras(
          { casualties: tx.table("casualties"), outbox: tx.table("outbox"), meta: tx.table("meta") },
          readLegacyBag(),
        ),
      );
    // v4: drops the casualty indexes nothing queries (only `active` is), and moves
    // the printed injury target out of the free-text description into `siteCode`,
    // in stored cards, queued rows, and open conflicts alike.
    this.version(4)
      .stores({ casualties: "id, active" })
      .upgrade(async (tx) => {
        await tx.table("casualties").toCollection().modify((card: { injurySites?: LegacyInjury[] }) => {
          if (card.injurySites) card.injurySites = card.injurySites.map((row) => withSiteCode(row));
        });
        await tx.table("outbox").toCollection().modify((entry: { op?: string; entity?: string; row?: LegacyInjury }) => {
          if (entry.op === "child.upsert" && entry.entity === "injurySite" && entry.row) entry.row = withSiteCode(entry.row);
        });
        await tx.table("conflicts").toCollection().modify((row: { entity?: string; kept?: unknown; discarded?: unknown }) => {
          if (row.entity !== "injurySite") return;
          if (isLegacyInjury(row.kept)) row.kept = withSiteCode(row.kept);
          if (isLegacyInjury(row.discarded)) row.discarded = withSiteCode(row.discarded);
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
