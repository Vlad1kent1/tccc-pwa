import { compareHlc, type EvacPriority } from "@tccc/shared";
import type { SyncStatus } from "@/lib/db/types";

/** Fields the list needs in order to sort, filter, and search. */
export interface ListCard {
  evacPriority: EvacPriority | null;
  syncStatus: SyncStatus;
  clientUpdatedAt: string;
  lastName: string | null;
  firstName: string | null;
  battleRosterNumber: string | null;
  deletedAt: string | null;
}

export type PriorityFilter = "all" | EvacPriority;
export type SyncFilter = "all" | SyncStatus;

export interface ListFilters {
  priority: PriorityFilter;
  sync: SyncFilter;
  query: string;
}

/** Unset priority sorts after every explicit triage category. */
const PRIORITY_RANK: Record<EvacPriority, number> = {
  URGENT: 0,
  PRIORITY: 1,
  ROUTINE: 2,
};

export function triageRank(priority: EvacPriority | null): number {
  return priority == null ? 3 : PRIORITY_RANK[priority];
}

/** Urgent first, then priority, then routine; newest hybrid clock within a rank. */
export function compareCasualties(a: ListCard, b: ListCard): number {
  const byPriority = triageRank(a.evacPriority) - triageRank(b.evacPriority);
  if (byPriority !== 0) return byPriority;
  return compareHlc(b.clientUpdatedAt, a.clientUpdatedAt);
}

export function matchesCasualtyQuery(card: ListCard, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const last = card.lastName ?? "";
  const first = card.firstName ?? "";
  const haystack = [last, first, `${last} ${first}`, `${first} ${last}`, card.battleRosterNumber ?? ""]
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

export function listCasualties<T extends ListCard>(cards: readonly T[], filters: ListFilters): T[] {
  return cards
    .filter((card) => {
      if (card.deletedAt != null) return false;
      if (filters.priority !== "all" && card.evacPriority !== filters.priority) return false;
      if (filters.sync !== "all" && card.syncStatus !== filters.sync) return false;
      return matchesCasualtyQuery(card, filters.query);
    })
    .sort(compareCasualties);
}
