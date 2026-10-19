"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import { useT } from "@/i18n/use-t";
import { CardLoading, MissingCard } from "@/components/ui/missing-card";
import { useLocalCard } from "@/components/pages/casualties/use-local-card";
import { FluidsBlock } from "@/components/pages/casualties/board/block-fluids";
import { IdentificationBlock } from "@/components/pages/casualties/board/block-identification";
import { InjuryBlock } from "@/components/pages/casualties/board/block-injury";
import { MechanismBlock } from "@/components/pages/casualties/board/block-mechanism";
import { MedicationsBlock } from "@/components/pages/casualties/board/block-medications";
import { NotesBlock } from "@/components/pages/casualties/board/block-notes";
import { OtherBlock } from "@/components/pages/casualties/board/block-other";
import { PersonalBlock } from "@/components/pages/casualties/board/block-personal";
import { ResponderBlock } from "@/components/pages/casualties/board/block-responder";
import { SaveBar } from "@/components/pages/casualties/board/save-bar";
import { TreatmentBlock } from "@/components/pages/casualties/board/block-treatments";
import { VitalsBlock } from "@/components/pages/casualties/board/block-vitals";
import {
  BoardProvider,
  boardForCard,
  createDraftBoard,
  peekBoard,
  useBoard,
  useFlushBoardOnHide,
  useRetainBoard,
  useSlice,
} from "@/components/pages/casualties/board/store";

export function TacticalBoard({ mode }: { mode: "new" | "edit" }) {
  const { t } = useT();
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [ready, setReady] = useState(mode === "new");
  const card = useLocalCard(ready ? id : null);
  const [draft] = useState(createDraftBoard);
  // A new casualty edits the draft until it creates its card; the draft then becomes that card's store.
  const store = card ? boardForCard(card) : id ? peekBoard(id) : mode === "new" ? draft : undefined;

  useLayoutEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
    setReady(true);
  }, []);

  useEffect(
    () =>
      draft.subscribeId((created) => {
        setId(created);
        if (window.location.pathname === "/casualties/new") {
          window.history.replaceState(window.history.state, "", `/casualties/new?id=${encodeURIComponent(created)}`);
        }
      }),
    [draft],
  );

  useRetainBoard(store);

  useEffect(() => {
    if (card && store) store.hydrate(card);
  }, [card, store]);

  useFlushBoardOnHide();

  if (mode === "edit" && ready && (!id || card === null)) return <MissingCard />;
  if (!store) return <CardLoading />;

  return (
    <BoardProvider store={store}>
      <main className={`mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-4 ${mode === "new" ? "pb-[calc(6rem+env(safe-area-inset-bottom))]" : "pb-16"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{mode === "edit" ? t("card.editTitle") : t("wizard.title")}</h1>
        {id ? (
          <Link
            href={`/casualties/card?id=${encodeURIComponent(id)}`}
            className="btn btn-ghost"
            onClick={(event) => {
              event.preventDefault();
              const href = `/casualties/card?id=${encodeURIComponent(id)}`;
              void store.flush().finally(() => router.push(href));
            }}
          >
            {t("card.viewCard")}
          </Link>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t("wizard.localSave")}</p>
      <RemoteBanner />
      <div className="flex flex-col gap-6">
        <IdentificationBlock />
        <PersonalBlock />
        <MechanismBlock />
        <InjuryBlock />
        <VitalsBlock />
        <TreatmentBlock />
        <FluidsBlock />
        <MedicationsBlock />
        <OtherBlock />
        <NotesBlock />
        <ResponderBlock />
      </div>
      </main>
      {mode === "new" ? <SaveBar /> : null}
    </BoardProvider>
  );
}

/** A newer version of the card arrived while this store had unsaved edits. */
export function RemoteBanner() {
  const { t } = useT();
  const board = useBoard();
  const remote = useSlice((state) => state.remote);
  if (!remote) return null;
  return (
    <div role="status" data-print-hide className="banner-warning">
      <p className="text-sm font-medium">{t("card.remoteChange")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={board.keepEdits}>
          {t("card.keepMine")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={board.loadUpdate}>
          {t("card.loadUpdated")}
        </button>
      </div>
    </div>
  );
}
