"use client";

import { useEffect, useRef, useState } from "react";
import { Limb, type Limb as LimbName, type Tourniquet } from "@tccc/shared";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";
import { fieldClass } from "./field";
import { TimeInput } from "./time-input";
import type { RegisterSaver } from "./wizard-save";

const LIMBS = [Limb.RIGHT_ARM, Limb.LEFT_ARM, Limb.RIGHT_LEG, Limb.LEFT_LEG] as const;

export function TourniquetGrid({
  cardId,
  rows,
  register,
}: {
  cardId: string;
  rows: Tourniquet[];
  register: RegisterSaver;
}) {
  const savers = useRef(new Map<LimbName, () => Promise<void>>());
  useEffect(
    () =>
      register("tourniquets", {
        save: async () => {
          await Promise.all([...savers.current.values()].map((save) => save()));
        },
        validate: async () => true,
      }),
    [register],
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      {LIMBS.map((limb) => (
        <TourniquetCell
          key={limb}
          cardId={cardId}
          limb={limb}
          row={rows.find((item) => item.limb === limb && item.deletedAt == null)}
          bind={(save) => {
            savers.current.set(limb, save);
            return () => savers.current.delete(limb);
          }}
        />
      ))}
    </div>
  );
}

function TourniquetCell({
  cardId,
  limb,
  row,
  bind,
}: {
  cardId: string;
  limb: LimbName;
  row: Tourniquet | undefined;
  bind: (save: () => Promise<void>) => () => void;
}) {
  const { t, enumLabel } = useT();
  const [type, setType] = useState(row?.type ?? "");
  const [appliedAt, setAppliedAt] = useState<string | null>(row?.appliedAt ?? null);
  const snapshot = useRef({ type: row?.type ?? "", appliedAt: row?.appliedAt ?? null, id: row?.id });
  const latest = useRef({ type, appliedAt });
  latest.current = { type, appliedAt };

  useEffect(() => {
    const current = snapshot.current;
    const nextType = row?.type ?? "";
    const nextTime = row?.appliedAt ?? null;
    if (current.id === row?.id && current.type === nextType && current.appliedAt === nextTime) return;
    setType(nextType);
    setAppliedAt(nextTime);
    snapshot.current = { type: nextType, appliedAt: nextTime, id: row?.id };
  }, [row?.id, row?.clientUpdatedAt, row?.type, row?.appliedAt]);

  async function saveNow(): Promise<void> {
    const trimmed = latest.current.type.trim();
    const time = latest.current.appliedAt;
    const current = snapshot.current;
    if (!trimmed) {
      if (!current.id) return;
      await casualtyRepo.deleteChild(cardId, "tourniquet", current.id);
      snapshot.current = { type: "", appliedAt: time, id: undefined };
      return;
    }
    if (!time || (current.type === trimmed && current.appliedAt === time && current.id)) return;
    const saved = await casualtyRepo.upsertChild(cardId, "tourniquet", { limb, type: trimmed, appliedAt: time });
    snapshot.current = { type: trimmed, appliedAt: time, id: saved.id };
  }

  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;

  useEffect(() => bind(() => saveRef.current()), [bind]);

  useEffect(() => {
    const timer = window.setTimeout(() => void saveNow(), 400);
    return () => window.clearTimeout(timer);
  }, [type, appliedAt, cardId, limb]);

  return (
    <fieldset className="surface flex flex-col gap-2">
      <legend className="px-1 text-sm font-medium">{enumLabel("Limb", limb)}</legend>
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{t("wizard.type")}</span>
        <input className={fieldClass} value={type} onChange={(event) => setType(event.target.value)} />
      </label>
      <TimeInput label={t("wizard.fields.administeredAt")} value={appliedAt} onChange={setAppliedAt} />
    </fieldset>
  );
}
