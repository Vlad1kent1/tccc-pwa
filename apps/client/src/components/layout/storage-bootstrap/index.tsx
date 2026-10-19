"use client";

import { useEffect } from "react";
import { setPersistenceDenied } from "@/components/layout/persistence-banner";
import { casualtyRepo, db, ensurePersistentStorage, finishLegacyExtrasMigration, loadServerClockOffset } from "@/lib/db";
import { startSyncTriggers } from "@/lib/sync";

let started = false;

export function StorageBootstrap() {
  useEffect(() => {
    if (started) return;
    started = true;
    void ensurePersistentStorage(db).then((granted) => {
      setPersistenceDenied(!granted);
    });
    void finishLegacyExtrasMigration(db, casualtyRepo.updateFields).catch((error: unknown) => {
      // The bag stays in place, so the next launch tries again.
      console.error("Legacy paper-field migration failed", error);
    });
    // The clock offset first: the queued rows are stamped with server-adjusted time.
    void loadServerClockOffset(db)
      .catch((error: unknown) => console.error("Could not load the server clock offset", error))
      .then(() => casualtyRepo.queueUnsyncedRows())
      .catch((error: unknown) => {
        // The flag stays unset, so the next launch tries again.
        console.error("Queueing unsynced rows failed", error);
      });
    startSyncTriggers(db);
  }, []);

  return null;
}
