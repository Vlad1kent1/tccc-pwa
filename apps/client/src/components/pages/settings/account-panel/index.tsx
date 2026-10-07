"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/use-t";
import { db, getDeviceId, getResponderProfile, setResponderProfile } from "@/lib/db";
import { fieldClass } from "@/components/ui/field";

export function AccountPanel() {
  const { t } = useT();
  const [name, setName] = useState("");
  const [last4, setLast4] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void getResponderProfile(db).then((profile) => {
      if (!profile) return;
      setName(profile.name);
      setLast4(profile.last4);
    });
    void getDeviceId(db).then(setDeviceId);
    const count = () => {
      void db.outbox.count().then(setPending);
    };
    count();
    const hook = () => count();
    db.outbox.hook("creating", hook);
    db.outbox.hook("deleting", hook);
    return () => {
      db.outbox.hook("creating").unsubscribe(hook);
      db.outbox.hook("deleting").unsubscribe(hook);
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <form
        className="surface flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d{4}$/.test(last4)) {
            setError(t("settings.invalidLast4"));
            return;
          }
          setError(null);
          void setResponderProfile(db, { name: name.trim(), last4 });
        }}
      >
        <h2 className="text-lg font-medium">{t("settings.responder")}</h2>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">{t("settings.name")}</span>
          <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">{t("settings.last4")}</span>
          <input
            className={fieldClass}
            inputMode="numeric"
            maxLength={4}
            value={last4}
            onChange={(event) => setLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button type="submit" className="btn btn-primary">
          {t("settings.saveProfile")}
        </button>
      </form>

      <section className="surface flex flex-col gap-2">
        <h2 className="text-lg font-medium">{t("settings.device")}</h2>
        <p className="break-all font-mono text-sm">{deviceId}</p>
      </section>

      <section className="surface flex flex-col gap-3">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void db.casualties.toArray().then((cards) => {
              const blob = new Blob([JSON.stringify(cards, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "tccc-cards.json";
              link.click();
              URL.revokeObjectURL(url);
            });
          }}
        >
          {t("settings.export")}
        </button>
        {pending > 0 ? <p className="text-sm text-muted">{t("settings.clearBlocked")}</p> : null}
        <button
          type="button"
          className="btn btn-danger"
          disabled={pending > 0}
          onClick={() => {
            if (!window.confirm(t("settings.clearConfirm"))) return;
            void db.transaction("rw", db.casualties, db.conflicts, async () => {
              await db.casualties.clear();
              await db.conflicts.clear();
            });
          }}
        >
          {t("settings.clear")}
        </button>
      </section>
    </div>
  );
}
