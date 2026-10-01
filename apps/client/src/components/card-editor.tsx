"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ZodType } from "zod";
import { useT } from "@/i18n/use-t";
import { casualtyRepo } from "@/lib/db";
import { persistSection } from "@/lib/forms/values";
import { CardLoading, MissingCard } from "./missing-card";
import { SectionA, SectionB, SectionC, SectionE, SectionF, SectionG, SectionH } from "./section-forms";
import { useLocalCard } from "./use-local-card";
import type { StepSaver } from "./wizard-save";

const SECTIONS = ["A", "B", "C", "E", "F", "G", "H"] as const;
type Section = (typeof SECTIONS)[number];

function parseSection(value: string | null): Section {
  return SECTIONS.includes(value as Section) ? (value as Section) : "A";
}

export function SectionTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useT();
  const id = params.get("id");
  const section = parseSection(params.get("section"));
  const card = useLocalCard(id);
  const savers = useRef(new Map<string, StepSaver>());

  const register = useCallback((name: string, saver: StepSaver) => {
    savers.current.set(name, saver);
    return () => savers.current.delete(name);
  }, []);

  const ensure = useCallback(
    async (schema: ZodType, values: unknown) => {
      if (!id) return;
      await persistSection(casualtyRepo, id, schema, values);
    },
    [id],
  );

  async function open(next: Section): Promise<void> {
    for (const saver of savers.current.values()) await saver.save();
    if (!id) return;
    router.replace(`/casualties/card/edit?id=${encodeURIComponent(id)}&section=${next}`);
  }

  if (card === undefined) return <CardLoading />;
  if (!card || !id) return <MissingCard />;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("card.editTitle")}</h1>
        <Link href={`/casualties/card?id=${encodeURIComponent(id)}`} className="btn btn-ghost">
          {t("card.viewCard")}
        </Link>
      </div>
      <nav aria-label={t("card.editTitle")} className="flex flex-wrap gap-2">
        {SECTIONS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={item === section ? "true" : undefined}
            onClick={() => void open(item)}
            className={item === section ? "chip chip-on" : "chip"}
          >
            {item} {t(`wizard.sections.${item}`)}
          </button>
        ))}
      </nav>
      <p className="text-sm text-muted">{t("wizard.localSave")}</p>
      {section === "A" ? <SectionA card={card} ensure={ensure} register={register} /> : null}
      {section === "B" ? <SectionB card={card} ensure={ensure} register={register} /> : null}
      {section === "C" ? <SectionC card={card} register={register} /> : null}
      {section === "E" ? <SectionE card={card} ensure={ensure} register={register} /> : null}
      {section === "F" ? <SectionF card={card} register={register} /> : null}
      {section === "G" ? <SectionG card={card} ensure={ensure} register={register} /> : null}
      {section === "H" ? <SectionH card={card} ensure={ensure} register={register} /> : null}
    </main>
  );
}
