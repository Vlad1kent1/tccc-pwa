"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { useT } from "@/i18n/use-t";
import type { LocalCasualtyCard } from "@/lib/db";
import { CardLoading, MissingCard } from "@/components/ui/missing-card";
import { useLocalCard } from "@/components/pages/casualties/use-local-card";
import { FluidsMeds } from "@/components/pages/casualties/board/fluids-meds";
import { IdentityBar } from "@/components/pages/casualties/board/identity-bar";
import { Mannequin } from "@/components/pages/casualties/board/mannequin";
import { MechanismRow } from "@/components/pages/casualties/board/mechanism-row";
import { NotesBlock, ResponderBlock } from "@/components/pages/casualties/board/notes-block";
import { hydrateBoard, keepBoardEdits, loadBoardUpdate, openSession, subscribeBoardId, useSlice } from "@/components/pages/casualties/board/store";
import { TreatmentRow } from "@/components/pages/casualties/board/treatment-row";
import { VitalsStrip } from "@/components/pages/casualties/board/vitals-strip";

export function TacticalBoard({ mode }: { mode: "new" | "edit" }) {
  const { t } = useT();
  const [id, setId] = useState<string | null>(null);
  const [ready, setReady] = useState(mode === "new");
  const card = useLocalCard(ready ? id : null);

  useLayoutEffect(() => {
    const next = new URLSearchParams(window.location.search).get("id");
    setId(next);
    setReady(true);
    if (!next) openSession(null);
    return subscribeBoardId((created) => setId(created));
  }, []);

  useEffect(() => {
    if (card) hydrateBoard(card);
  }, [card]);

  if (mode === "edit" && (!ready || (id && card === undefined))) return <CardLoading />;
  if (mode === "edit" && ready && (!id || card === null)) return <MissingCard />;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{mode === "edit" ? t("card.editTitle") : t("wizard.title")}</h1>
        {id ? (
          <Link href={`/casualties/card?id=${encodeURIComponent(id)}`} className="btn btn-ghost">
            {t("card.viewCard")}
          </Link>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t("wizard.localSave")}</p>
      <RemoteBanner card={card} />
      <IdentityBar />
      <MechanismRow />
      <Mannequin />
      <TreatmentRow />
      <VitalsStrip />
      <FluidsMeds />
      <NotesBlock />
      <ResponderBlock />
    </main>
  );
}

function RemoteBanner({ card }: { card: LocalCasualtyCard | null | undefined }) {
  const { t } = useT();
  const remote = useSlice((state) => state.remote);
  if (!remote || !card) return null;
  return (
    <div role="status" className="banner-warning">
      <p className="text-sm font-medium">{t("card.remoteChange")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={keepBoardEdits}>
          {t("card.keepMine")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={loadBoardUpdate}>
          {t("card.loadUpdated")}
        </button>
      </div>
    </div>
  );
}
