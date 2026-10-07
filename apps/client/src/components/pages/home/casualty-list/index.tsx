"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { EvacPriority } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { db, type LocalCasualtyCard, type SyncStatus } from "@/lib/db";
import { listCasualties, type PriorityFilter, type SyncFilter } from "@/lib/casualties/list";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { SyncBadge } from "@/components/ui/sync-badge";
import { SyncStatusBar } from "@/components/pages/home/sync-status-bar";

const priorities = [EvacPriority.URGENT, EvacPriority.PRIORITY, EvacPriority.ROUTINE] as const;
const syncStates: SyncStatus[] = ["pending", "synced", "conflict"];

const priorityStripe: Record<EvacPriority, string> = {
  URGENT: "priority-urgent",
  PRIORITY: "priority-priority",
  ROUTINE: "priority-routine",
};

function displayName(card: LocalCasualtyCard, unnamed: string): string {
  const name = [card.lastName, card.firstName].filter(Boolean).join(" ");
  return name || unnamed;
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16l-6.5 7.5V19l-3-1.5v-5L4 5z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none size-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={pressed ? "chip chip-on" : "chip"}
    >
      {children}
    </button>
  );
}

export function CasualtyList() {
  const { t, enumLabel } = useT();
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [sync, setSync] = useState<SyncFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const cards = useLiveQuery(() => db.casualties.where("active").equals(1).toArray());

  const visible = useMemo(
    () => (cards ? listCasualties(cards, { priority, sync, query }) : []),
    [cards, priority, sync, query],
  );

  const filtersActive = priority !== "all" || sync !== "all";
  const filtering = query.trim() !== "" || filtersActive;
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const update = () => setScrollMargin(node.offsetTop);
    update();
    const parent = node.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [filtersOpen, visible.length]);
  const virtualizer = useWindowVirtualizer({
    count: visible.length,
    estimateSize: () => 88,
    overscan: 8,
    gap: 10,
    scrollMargin,
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4 pb-[max(7rem,env(safe-area-inset-bottom))]">
      <h1 className="text-2xl font-semibold">{t("list.heading")}</h1>
      <SyncStatusBar count={visible.length} />
      <div className="relative z-10 flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("list.searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("list.searchPlaceholder")}
            className="input"
          />
        </label>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="casualty-filters"
          aria-label={t("list.filters")}
          onClick={() => setFiltersOpen((open) => !open)}
          className={`btn btn-icon ${filtersOpen || filtersActive ? "btn-primary" : "btn-secondary"}`}
        >
          <FilterIcon />
        </button>
      </div>
      <div id="casualty-filters" hidden={!filtersOpen} className={filtersOpen ? "relative z-10 flex flex-col gap-3" : undefined}>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("list.priorityFilter")}>
          <span className="text-sm text-muted">{t("list.priorityFilter")}</span>
          <Chip pressed={priority === "all"} onClick={() => setPriority("all")}>
            {t("list.all")}
          </Chip>
          {priorities.map((value) => (
            <Chip key={value} pressed={priority === value} onClick={() => setPriority(value)}>
              {enumLabel("EvacPriority", value)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("list.syncFilter")}>
          <span className="text-sm text-muted">{t("list.syncFilter")}</span>
          <Chip pressed={sync === "all"} onClick={() => setSync("all")}>
            {t("list.all")}
          </Chip>
          {syncStates.map((value) => (
            <Chip key={value} pressed={sync === value} onClick={() => setSync(value)}>
              {t(`syncStatus.${value}`)}
            </Chip>
          ))}
        </div>
      </div>
      {cards && visible.length === 0 ? (
        <p className="py-8 text-muted">{filtering ? t("list.emptyFiltered") : t("list.empty")}</p>
      ) : (
        <div ref={listRef}>
          <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const card = visible[item.index];
              if (!card) return null;
              return (
                <li
                  key={card.id}
                  data-index={item.index}
                  data-priority={card.evacPriority ?? "unset"}
                  ref={virtualizer.measureElement}
                  className={`row absolute top-0 left-0 flex w-full items-stretch gap-2 overflow-hidden ${
                    card.evacPriority ? priorityStripe[card.evacPriority] : "priority-unset"
                  }`}
                  style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
                >
                  <Link
                    href={`/casualties/card?id=${encodeURIComponent(card.id)}`}
                    className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{displayName(card, t("list.unnamed"))}</span>
                      {card.battleRosterNumber ? (
                        <span className="block truncate text-sm text-muted">{card.battleRosterNumber}</span>
                      ) : null}
                    </span>
                    <PriorityBadge priority={card.evacPriority} />
                  </Link>
                  <span className="flex items-center pr-2">
                    <SyncBadge status={card.syncStatus} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link
        href="/casualties/new"
        data-print-hide
        aria-label={t("list.newCasualty")}
        className="btn btn-primary fab"
      >
        <PlusIcon />
      </Link>
    </main>
  );
}
