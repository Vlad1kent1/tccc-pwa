"use client";

import { CHILD_COLLECTIONS, type CardPatch, type ChildEntity } from "@tccc/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useT } from "@/i18n/use-t";
import { casualtyRepo, db, type LocalConflict, type OutboxMutation } from "@/lib/db";
import { requestSync, useSyncStatus } from "@/lib/sync";

function showValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

async function clearConflict(conflict: LocalConflict): Promise<void> {
  await db.conflicts.update(conflict.id, { resolvedAt: new Date().toISOString() });
  const left = await db.conflicts.filter((row) => row.cardId === conflict.cardId && row.resolvedAt == null).count();
  if (left === 0) {
    const card = await db.casualties.get(conflict.cardId);
    if (card && card.syncStatus === "conflict") {
      const pending = await db.outbox.where("cardId").equals(conflict.cardId).count();
      await db.casualties.update(conflict.cardId, { syncStatus: pending > 0 ? "pending" : "synced" });
    }
  }
}

async function useDiscarded(conflict: LocalConflict): Promise<void> {
  const card = await db.casualties.get(conflict.cardId);
  if (!card) return;
  if (conflict.entity === "card") {
    await casualtyRepo.updateFields(conflict.cardId, { [conflict.field]: conflict.discarded } as CardPatch);
  } else {
    const entity = conflict.entity as ChildEntity;
    const rows = card[CHILD_COLLECTIONS[entity]] as Array<{ id: string }>;
    const row = rows.find((item) => item.id === conflict.entityId);
    if (!row) return;
    await casualtyRepo.upsertChild(conflict.cardId, entity, {
      ...row,
      [conflict.field]: conflict.discarded,
    } as never);
  }
  await clearConflict(conflict);
}

export function SyncPanel() {
  const { t } = useT();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const outbox = useLiveQuery(() => db.outbox.orderBy("seq").toArray(), [], [] as OutboxMutation[]);
  const conflicts = useLiveQuery(
    () => db.conflicts.filter((row) => row.resolvedAt == null).toArray(),
    [],
    [] as LocalConflict[],
  );

  const last = status.lastSyncAt
    ? t("syncPage.last", { time: new Date(status.lastSyncAt).toLocaleString() })
    : t("syncPage.never");

  return (
    <section aria-labelledby="sync-heading" className="surface flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="sync-heading" className="text-lg font-medium">
          {t("syncPage.heading")}
        </h2>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || status.state === "syncing"}
          onClick={() => {
            setBusy(true);
            void requestSync(db).finally(() => setBusy(false));
          }}
        >
          {t("syncPage.now")}
        </button>
      </div>
      <p className="text-sm text-muted">{last}</p>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("syncPage.outbox")}</h3>
        {outbox.length === 0 ? (
          <p className="text-sm text-muted">{t("syncPage.emptyOutbox")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {outbox.map((entry) => (
              <li key={entry.mutationId} className="rounded-lg border border-border bg-background p-3">
                <p className="font-medium">
                  {entry.op} · {entry.status}
                </p>
                <p className="text-sm text-muted">{t("syncPage.attempts", { count: entry.attempts })}</p>
                {entry.lastError ? <p className="error-text">{entry.lastError}</p> : null}
                {entry.status === "failed" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        if (entry.seq == null) return;
                        void db.outbox.update(entry.seq, { status: "queued", lastError: undefined }).then(() => requestSync(db));
                      }}
                    >
                      {t("syncPage.retry")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        if (entry.seq == null) return;
                        void db.outbox.delete(entry.seq);
                      }}
                    >
                      {t("syncPage.discard")}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="conflicts" className="flex scroll-mt-24 flex-col gap-3">
        <h3 className="text-sm font-medium">{t("syncPage.conflicts")}</h3>
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted">{t("syncPage.emptyConflicts")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {conflicts.map((conflict) => (
              <li key={conflict.id} className="rounded-lg border border-border bg-background p-3">
                <p className="font-medium">
                  {conflict.entity} · {conflict.field}
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">{t("syncPage.kept")}</dt>
                  <dd>{showValue(conflict.kept)}</dd>
                  <dt className="text-muted">{t("syncPage.discarded")}</dt>
                  <dd>{showValue(conflict.discarded)}</dd>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void clearConflict(conflict)}
                  >
                    {t("syncPage.keep")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void useDiscarded(conflict)}
                  >
                    {t("syncPage.useOther")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
