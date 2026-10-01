"use client";

import { useState } from "react";
import { BodyView, type BodyRegion, type BodyView as BodyViewName } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { fieldClass } from "./field";

export interface DiagramSite {
  id: string;
  region: BodyRegion;
  view: BodyViewName;
  x: number | null;
  y: number | null;
  description: string | null;
}

type Hit = { region: BodyRegion; x: number; y: number; w: number; h: number };

/** Patient's right is on the viewer's left when looking at the front. */
const FRONT: Hit[] = [
  { region: "RIGHT_ARM", x: 4, y: 52, w: 22, h: 72 },
  { region: "LEFT_ARM", x: 74, y: 52, w: 22, h: 72 },
  { region: "RIGHT_LEG", x: 30, y: 130, w: 18, h: 82 },
  { region: "LEFT_LEG", x: 52, y: 130, w: 18, h: 82 },
  { region: "HEAD", x: 36, y: 4, w: 28, h: 14 },
  { region: "FACE", x: 36, y: 18, w: 28, h: 18 },
  { region: "NECK", x: 42, y: 36, w: 16, h: 12 },
  { region: "CHEST", x: 28, y: 48, w: 44, h: 36 },
  { region: "ABDOMEN", x: 30, y: 84, w: 40, h: 24 },
  { region: "PELVIS", x: 32, y: 108, w: 36, h: 22 },
];

/** On the back, the patient's right is on the viewer's right. */
const BACK: Hit[] = [
  { region: "LEFT_ARM", x: 4, y: 52, w: 22, h: 72 },
  { region: "RIGHT_ARM", x: 74, y: 52, w: 22, h: 72 },
  { region: "LEFT_LEG", x: 30, y: 130, w: 18, h: 82 },
  { region: "RIGHT_LEG", x: 52, y: 130, w: 18, h: 82 },
  { region: "HEAD", x: 36, y: 4, w: 28, h: 32 },
  { region: "NECK", x: 42, y: 36, w: 16, h: 12 },
  { region: "UPPER_BACK", x: 28, y: 48, w: 44, h: 36 },
  { region: "LOWER_BACK", x: 30, y: 84, w: 40, h: 24 },
  { region: "PELVIS", x: 32, y: 108, w: 36, h: 22 },
];

const VIEWBOX_WIDTH = 100;
const VIEWBOX_HEIGHT = 220;

export function BodyDiagram({
  sites,
  readOnly = false,
  view: lockedView,
  onAdd,
  onUpdate,
  onDelete,
}: {
  sites: DiagramSite[];
  readOnly?: boolean;
  /** When set, the diagram stays on this side and hides the front/back switch. */
  view?: BodyViewName;
  onAdd?: (site: { region: BodyRegion; view: BodyViewName; x: number; y: number }) => void;
  onUpdate?: (site: DiagramSite) => void;
  onDelete?: (id: string) => void;
}) {
  const { t, enumLabel } = useT();
  const [viewState, setView] = useState<BodyViewName>(lockedView ?? BodyView.FRONT);
  const view = lockedView ?? viewState;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const hits = view === "FRONT" ? FRONT : BACK;
  const visible = sites.filter((site) => site.view === view);
  const selected = sites.find((site) => site.id === selectedId) ?? null;

  function addAt(hit: Hit, x: number, y: number): void {
    if (readOnly || !onAdd) return;
    onAdd({
      region: hit.region,
      view,
      x: clamp(x),
      y: clamp(y),
    });
  }

  function select(site: DiagramSite): void {
    setSelectedId(site.id);
    setDraft(site.description ?? "");
  }

  function commitDescription(): void {
    if (!selected || !onUpdate) return;
    const description = draft.trim() ? draft.trim() : null;
    if (description === selected.description) return;
    onUpdate({ ...selected, description });
  }

  return (
    <div className="flex flex-col gap-3">
      {lockedView ? null : (
      <div className="flex gap-2" role="group" aria-label={t("wizard.bodyDiagram")}>
        {([BodyView.FRONT, BodyView.BACK] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => {
              setView(item);
              setSelectedId(null);
            }}
            className={view === item ? "chip chip-on" : "chip"}
          >
            {item === "FRONT" ? t("wizard.viewFront") : t("wizard.viewBack")}
          </button>
        ))}
      </div>
      )}
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="pointer-events-auto mx-auto h-auto w-full max-w-xs touch-manipulation"
        role="group"
        aria-label={t("wizard.bodyDiagram")}
        onClick={(event) => {
          const target = event.target as SVGElement;
          const marker = target.getAttribute("data-site-id");
          if (marker) {
            if (readOnly) return;
            const site = sites.find((item) => item.id === marker);
            if (site) select(site);
            return;
          }
          if (readOnly) return;
          const region = target.getAttribute("data-region") as BodyRegion | null;
          const hit = hits.find((item) => item.region === region);
          if (!hit) return;
          const svg = event.currentTarget;
          const matrix = svg.getScreenCTM();
          if (!matrix) return;
          const point = svg.createSVGPoint();
          point.x = event.clientX;
          point.y = event.clientY;
          const local = point.matrixTransform(matrix.inverse());
          addAt(hit, local.x / VIEWBOX_WIDTH, local.y / VIEWBOX_HEIGHT);
        }}
      >
        {hits.map((hit) => (
          <rect
            key={hit.region}
            data-region={hit.region}
            x={hit.x}
            y={hit.y}
            width={hit.w}
            height={hit.h}
            rx="3"
            tabIndex={readOnly ? undefined : 0}
            role={readOnly ? undefined : "button"}
            aria-label={enumLabel("BodyRegion", hit.region)}
            className="cursor-pointer fill-surface stroke-foreground outline-none focus-visible:fill-accent/30"
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              addAt(hit, (hit.x + hit.w / 2) / VIEWBOX_WIDTH, (hit.y + hit.h / 2) / VIEWBOX_HEIGHT);
            }}
          />
        ))}
        {visible.map((site) => (
          <circle
            key={site.id}
            data-site-id={site.id}
            cx={(site.x ?? 0.5) * VIEWBOX_WIDTH}
            cy={(site.y ?? 0.5) * VIEWBOX_HEIGHT}
            r={selectedId === site.id ? 5 : 3.5}
            className="pointer-events-auto cursor-pointer fill-urgent stroke-background"
          >
            <title>{enumLabel("BodyRegion", site.region)}</title>
          </circle>
        ))}
      </svg>
      {selected && !readOnly ? (
        <div className="surface pointer-events-auto flex flex-col gap-2">
          <p className="text-sm font-medium">
            {enumLabel("BodyRegion", selected.region)} · {enumLabel("BodyView", selected.view)}
          </p>
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">{t("wizard.description")}</span>
            <input
              className={fieldClass}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitDescription}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onDelete?.(selected.id);
              setSelectedId(null);
            }}
            className="btn btn-secondary"
          >
            {t("wizard.remove")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
