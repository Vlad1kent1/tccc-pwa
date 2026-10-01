import type {
  CardFields,
  ChildCollections,
  ChildEntity,
  HlcState,
  Mutation,
  SyncConflictInfo,
} from "@tccc/shared";

export type SyncStatus = "pending" | "synced" | "conflict";

/**
 * One IndexedDB record per card, with child rows embedded (PLAN.md 3.6), so a
 * card is written atomically and rendered from a single read.
 */
export type LocalCasualtyCard = CardFields &
  ChildCollections & {
    id: string;
    /** Per-field HLC of the last local or server write, used for field-level LWW. */
    fieldClock: Record<string, string>;
    syncStatus: SyncStatus;
    /** Last version acknowledged by the server; sent as `baseVersion` on the next push. */
    serverVersion: number | null;
    changeSeq: string | null;
    createdByDeviceId: string;
    createdAt: string;
    /** HLC of the latest local write; also the index used to sort by recency. */
    clientUpdatedAt: string;
    serverUpdatedAt: string | null;
    deletedAt: string | null;
  };

export type OutboxStatus = "queued" | "inflight" | "failed";

export type OutboxMutation = Mutation & {
  seq?: number;
  status: OutboxStatus;
  attempts: number;
  createdAt: number;
  lastError?: string;
};

export type LocalConflict = SyncConflictInfo & {
  id: string;
  cardId: string;
  createdAt: string;
  resolvedAt: string | null;
};

export interface ResponderProfile {
  name: string;
  last4: string;
}

export interface MetaValues {
  deviceId: string;
  /** Pull cursor (`changeSeq` as a decimal string). */
  lastPullSeq: string;
  hlcState: HlcState;
  /** serverTime - Date.now(), measured on the last successful sync. */
  serverClockOffsetMs: number;
  responderProfile: ResponderProfile;
  persistenceRequested: boolean;
  locale: "en" | "uk";
}

export type MetaKey = keyof MetaValues;

export type MetaEntry = { [K in MetaKey]: { key: K; value: MetaValues[K] } }[MetaKey];

export type { ChildEntity };
