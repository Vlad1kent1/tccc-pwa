"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { db } from "@/lib/db";
import { requestSync } from "@/lib/sync";

export function MissingCard() {
  const { t } = useT();
  const [syncing, setSyncing] = useState(false);

  async function sync(): Promise<void> {
    setSyncing(true);
    try {
      await requestSync(db);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8">
      <p>{t("card.notFound")}</p>
      <button
        type="button"
        disabled={syncing}
        onClick={() => void sync()}
        className="btn btn-primary"
      >
        {syncing ? t("card.syncing") : t("card.syncNow")}
      </button>
      <Link href="/" className="btn btn-ghost">
        {t("card.backToList")}
      </Link>
    </main>
  );
}

export function CardLoading() {
  const { t } = useT();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 px-4 py-8">
      <p>{t("card.loading")}</p>
    </main>
  );
}
