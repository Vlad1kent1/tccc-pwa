"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalCasualtyCard } from "@/lib/db";

/** `undefined` while IndexedDB is loading, `null` when the id is missing or deleted. */
export function useLocalCard(id: string | null): LocalCasualtyCard | null | undefined {
  return useLiveQuery(
    async () => {
      if (!id) return null;
      const row = await db.casualties.get(id);
      return row && !row.deletedAt ? row : null;
    },
    [id],
    id ? undefined : null,
  );
}
