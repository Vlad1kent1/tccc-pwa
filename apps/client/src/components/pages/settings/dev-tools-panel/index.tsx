"use client";

import { useState } from "react";
import { EvacPriority } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";

const FIRST_NAMES = ["Oleksandr", "Nataliia", "Yurii", "Olena", "Maksym", "Kateryna", "Andrii", "Iryna", "Serhii", "Oksana"];
const LAST_NAMES = ["Kovalenko", "Shevchenko", "Melnyk", "Bondarenko", "Kravchenko", "Tkachenko", "Boyko", "Koval", "Oliinyk", "Lysenko"];
const PRIORITIES = [EvacPriority.URGENT, EvacPriority.PRIORITY, EvacPriority.ROUTINE] as const;

export function DevToolsPanel() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setBusy(true);
    setDone(false);
    setError(null);
    try {
      for (let index = 0; index < 30; index += 1) {
        await casualtyRepo.create({
          lastName: LAST_NAMES[index % LAST_NAMES.length] ?? "Kovalenko",
          firstName: FIRST_NAMES[Math.floor(index / LAST_NAMES.length) % FIRST_NAMES.length] ?? "Oleksandr",
          battleRosterNumber: `MK${String(index + 1).padStart(2, "0")}`,
          evacPriority: PRIORITIES[index % PRIORITIES.length] ?? EvacPriority.ROUTINE,
        });
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="dev-tools-heading" className="surface flex flex-col gap-4">
      <h2 id="dev-tools-heading" className="text-lg font-medium">
        {t("dev.heading")}
      </h2>
      <p className="text-sm text-muted">{t("dev.mockHint")}</p>
      <button type="button" className="btn btn-secondary self-start" disabled={busy} onClick={() => void generate()}>
        {busy ? t("dev.generating") : t("dev.generate")}
      </button>
      {done ? <p className="text-sm text-muted">{t("dev.generated")}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
