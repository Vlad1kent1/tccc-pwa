"use client";

import { useCardCopy } from "@/components/pages/casualties/dd1380/copy";
import { Choice, Dash, Line } from "@/components/pages/casualties/dd1380/ua-fields";

const EVAC = ["evac_urgent", "evac_priority", "evac_routine"] as const;

/** Battle roster and evacuation, repeated on both sides of the card. */
export function RosterEvac({ ruleAfterEvac = false }: { ruleAfterEvac?: boolean }) {
  const copy = useCardCopy();
  return (
    <div>
      <div className="flex items-end gap-[0.35em]">
        <span className="shrink-0 font-bold">{copy.roster}</span>
        <Line name="roster" />
      </div>
      <Dash />
      <div
        role="radiogroup"
        aria-label={copy.evacGroup}
        className="flex flex-wrap items-center justify-center gap-x-[0.75em] gap-y-[0.15em]"
      >
        <span className="font-bold">{copy.evac}</span>
        <Choice name="evac_urgent" group="evac" members={EVAC}>
          {copy.urgent}
        </Choice>
        <Choice name="evac_priority" group="evac" members={EVAC}>
          {copy.priority}
        </Choice>
        <Choice name="evac_routine" group="evac" members={EVAC}>
          {copy.routine}
        </Choice>
      </div>
      {ruleAfterEvac ? <Dash /> : null}
    </div>
  );
}
