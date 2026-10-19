"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Dd1380Card } from "@/components/pages/casualties/dd1380/dd1380-card";
import { useT } from "@/i18n/use-t";
import type { LocalCasualtyCard } from "@/lib/db";
import { CardLoading, MissingCard } from "@/components/ui/missing-card";
import { SyncBadge } from "@/components/ui/sync-badge";
import { useLocalCard } from "@/components/pages/casualties/use-local-card";
import { sheetFormSource, sheetMarks } from "@/components/pages/casualties/board/sheet";
import { RemoteBanner } from "@/components/pages/casualties/board/tactical-board";
import {
  BoardProvider,
  boardForCard,
  useBoard,
  useFlushBoardOnHide,
  useRetainBoard,
  useSlice,
} from "@/components/pages/casualties/board/store";

export function CardView() {
  const params = useSearchParams();
  const id = params.get("id");
  const card = useLocalCard(id);
  if (card === undefined) return <CardLoading />;
  if (!card || !id) return <MissingCard />;
  return <CardSheet card={card} />;
}

/** The DD1380 sheet edits the same per-card store as the tactical board. */
function CardSheet({ card }: { card: LocalCasualtyCard }) {
  const store = boardForCard(card);
  useRetainBoard(store);

  useLayoutEffect(() => {
    store.hydrate(card);
  }, [store, card]);

  // The printed tables are re-sorted when the card is opened, never while it is edited.
  // Typed sheet text belongs to this visit; it is dropped when the sheet closes.
  useLayoutEffect(() => {
    store.resetPaperLayout();
    return () => store.clearSheetText();
  }, [store]);

  useFlushBoardOnHide();

  return (
    <BoardProvider store={store}>
      <SheetPage syncStatus={card.syncStatus} />
    </BoardProvider>
  );
}

function SheetPage({ syncStatus }: { syncStatus: LocalCasualtyCard["syncStatus"] }) {
  const { t } = useT();
  const router = useRouter();
  const board = useBoard();
  // Only what this page itself shows: typing in a field re-renders that field, not the page.
  const cardId = useSlice((state) => state.cardId) ?? "";
  const injuries = useSlice((state) => state.injuries);
  const marks = useMemo(() => sheetMarks(injuries), [injuries]);
  const source = useMemo(() => sheetFormSource(board), [board]);
  const editHref = `/casualties/card/edit?id=${encodeURIComponent(cardId)}&section=A`;

  return (
    <main className="mx-auto flex w-full max-w-368 flex-1 flex-col gap-4 px-3 py-4 lg:px-4 print:m-0 print:max-w-none print:gap-0 print:p-0 print:shadow-none">
      <div className="flex flex-row justify-between gap-2">
        <span className="inline-flex min-h-12 items-center">
          <SyncBadge status={syncStatus} />
        </span>
        <div data-print-hide className="flex flex-wrap gap-2">
          <RemoteBanner />
          <Link
            href={editHref}
            className="btn btn-primary"
            onClick={(event) => {
              event.preventDefault();
              void board.flush().finally(() => router.push(editHref));
            }}
          >
            {t("card.edit")}
          </Link>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">
            {t("card.print")}
          </button>
        </div>
      </div>
      <Dd1380Card source={source} marks={marks} />
    </main>
  );
}
