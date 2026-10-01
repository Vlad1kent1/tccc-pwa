"use client";

import { useEffect } from "react";
import { setPersistenceDenied } from "@/components/persistence-banner";
import { db, ensurePersistentStorage } from "@/lib/db";
import { startSyncTriggers } from "@/lib/sync";

// Module-level guard: React Strict Mode runs effects twice in development.
let started = false;

export function StorageBootstrap() {
  useEffect(() => {
    if (started) return;
    started = true;
    void ensurePersistentStorage(db).then((granted) => {
      setPersistenceDenied(!granted);
    });
    startSyncTriggers(db);
  }, []);

  return null;
}
