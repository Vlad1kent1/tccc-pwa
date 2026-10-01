"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Dd1380Card } from "@/components/dd1380/dd1380-card";
import { useBoundDd1380 } from "@/components/dd1380/use-bound-form";
import { useT } from "@/i18n/use-t";
import type { LocalCasualtyCard } from "@/lib/db";
import { CardLoading, MissingCard } from "./missing-card";
import { SyncBadge } from "./sync-badge";
import { useLocalCard } from "./use-local-card";

export function CardView() {
  const params = useSearchParams();
  const id = params.get("id");
  const card = useLocalCard(id);
  if (card === undefined) return <CardLoading />;
  if (!card || !id) return <MissingCard />;
  return <CardSheet card={card} />;
}

function CardSheet({ card }: { card: LocalCasualtyCard }) {
  const { t } = useT();
  const href = encodeURIComponent(card.id);
  const { values, onChange } = useBoundDd1380(card);

  return (
    <main className="mx-auto flex w-full max-w-368 flex-1 flex-col gap-4 px-3 py-4 lg:px-4 print:m-0 print:max-w-none print:gap-0 print:p-0 print:shadow-none">
      <div data-print-hide className="flex flex-wrap gap-2">
        <Link href={`/casualties/card/edit?id=${href}&section=A`} className="btn btn-primary">
          {t("card.edit")}
        </Link>
        <Link href={`/casualties/card/vitals?id=${href}`} className="btn btn-secondary">
          {t("card.vitals")}
        </Link>
        <button type="button" onClick={() => window.print()} className="btn btn-secondary">
          {t("card.print")}
        </button>
        <span className="inline-flex min-h-12 items-center">
          <SyncBadge status={card.syncStatus} />
        </span>
      </div>

      <Dd1380Card values={values} onChange={onChange} />
    </main>
  );
}
