"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import type { ZodType } from "zod";
import { useT } from "@/i18n/use-t";
import { casualtyRepo, db, getResponderProfile, type LocalCasualtyCard } from "@/lib/db";
import { responderPatch, validPatch } from "@/lib/forms/values";
import { SectionA, SectionB, SectionC, SectionE, SectionF, SectionG, SectionH } from "./section-forms";
import type { RegisterSaver, StepSaver } from "./wizard-save";

const STEPS = ["A", "B", "C", "E", "F", "G", "H"] as const;
type Step = (typeof STEPS)[number];

let pendingCreate: Promise<LocalCasualtyCard> | null = null;

function parseStep(value: string | null): Step {
  return STEPS.includes(value as Step) ? (value as Step) : "A";
}

export function CardWizard() {
  const router = useRouter();
  const { t } = useT();
  // Defaults match the server render. Reading the query here would bail the
  // page out to client-side rendering, and the offline shell would have no fields.
  const [id, setId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("A");
  const [ready, setReady] = useState(false);
  const idRef = useRef(id);
  const stepRef = useRef(step);
  const announcedId = useRef<string | null>(null);
  idRef.current = id;
  stepRef.current = step;

  useEffect(() => {
    const applyLocation = () => {
      const nextId = new URLSearchParams(window.location.search).get("id");
      const nextStep = parseStep(new URLSearchParams(window.location.search).get("step"));
      // A fresh /casualties/new must not keep updating the card created on the previous visit.
      if (!nextId) {
        pendingCreate = null;
        announcedId.current = null;
      }
      idRef.current = nextId;
      stepRef.current = nextStep;
      setId(nextId);
      setStep(nextStep);
      setReady(true);
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    window.addEventListener("pageshow", applyLocation);
    return () => {
      window.removeEventListener("popstate", applyLocation);
      window.removeEventListener("pageshow", applyLocation);
    };
  }, []);
  const savers = useRef(new Map<string, StepSaver>());
  const [held, setHeld] = useState<LocalCasualtyCard | null>(null);

  const live = useLiveQuery(
    async () => {
      if (!id) return null;
      const row = await db.casualties.get(id);
      return row && !row.deletedAt ? row : null;
    },
    [id],
    id ? undefined : null,
  );

  useEffect(() => {
    if (id) pendingCreate = null;
  }, [id]);

  const ensure = useCallback(
    async (schema: ZodType, values: unknown) => {
      const patch = validPatch(schema, values);
      const urlId = new URLSearchParams(window.location.search).get("id");
      const entered = Object.values(patch).some((value) => {
        if (value == null || value === "") return false;
        if (Array.isArray(value)) return value.length > 0;
        return true;
      });
      if (!urlId && !entered) return;
      if (!urlId && idRef.current) {
        idRef.current = null;
        pendingCreate = null;
        announcedId.current = null;
      }
      if (urlId) {
        idRef.current = urlId;
        if (Object.keys(patch).length > 0) setHeld(await casualtyRepo.updateFields(urlId, patch));
        return;
      }

      const first = pendingCreate == null;
      if (!pendingCreate) {
        const initial = patch;
        pendingCreate = (async () => {
          const profile = await getResponderProfile(db);
          return casualtyRepo.create({ ...responderPatch(profile), ...initial });
        })();
      }
      const created = await pendingCreate;
      idRef.current = created.id;
      const next = !first && Object.keys(patch).length > 0 ? await casualtyRepo.updateFields(created.id, patch) : created;
      setHeld(next);
      setId(created.id);
      // A router navigation fetches the RSC payload. Offline, the service worker
      // aborts that request and Playwright reports net::ERR_ABORTED. The id only
      // needs to be in the address bar, so update history without a page load.
      if (announcedId.current !== created.id) {
        announcedId.current = created.id;
        const url = `/casualties/new?id=${encodeURIComponent(created.id)}&step=${stepRef.current}`;
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [],
  );

  const register = useCallback<RegisterSaver>((name, saver) => {
    savers.current.set(name, saver);
    return () => savers.current.delete(name);
  }, []);

  async function leave(next: Step | "done", requireValid: boolean): Promise<void> {
    for (const saver of savers.current.values()) {
      if (requireValid) {
        if (!(await saver.validate())) return;
      } else {
        await saver.save();
      }
    }
    const cardId = idRef.current;
    if (next === "done") {
      if (cardId) router.push(`/casualties/card?id=${encodeURIComponent(cardId)}`);
      return;
    }
    stepRef.current = next;
    setStep(next);
    const query = cardId ? `id=${encodeURIComponent(cardId)}&step=${next}` : `step=${next}`;
    router.replace(`/casualties/new?${query}`);
  }

  if (id && live === undefined && !held) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 px-4 py-8">
        <p>{t("wizard.loading")}</p>
      </main>
    );
  }
  if (id && live === null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8">
        <p>{t("wizard.notFound")}</p>
      </main>
    );
  }

  const card = live === undefined ? held : live;
  const index = STEPS.indexOf(step);

  return (
    <main data-step={step} className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4 pb-8">
      <h1 className="text-2xl font-semibold">{t("wizard.title")}</h1>
      <p className="text-sm text-muted">{t("wizard.step", { current: index + 1, total: STEPS.length })}</p>
      <nav aria-label={t("wizard.title")} className="flex flex-wrap gap-2">
        {STEPS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={item === step ? "step" : undefined}
            onClick={() => void leave(item, STEPS.indexOf(item) > index)}
            className={item === step ? "chip chip-on" : "chip"}
          >
            {item} {t(`wizard.sections.${item}`)}
          </button>
        ))}
      </nav>
      <p className="text-sm text-muted">{t("wizard.localSave")}</p>
      {step === "A" ? <SectionA card={card} ensure={ensure} register={register} nameReady={ready} /> : null}
      {step === "B" && card ? <SectionB card={card} ensure={ensure} register={register} /> : null}
      {step === "C" && card ? <SectionC card={card} register={register} /> : null}
      {step === "E" && card ? <SectionE card={card} ensure={ensure} register={register} /> : null}
      {step === "F" && card ? <SectionF card={card} register={register} /> : null}
      {step === "G" ? <SectionG card={card} ensure={ensure} register={register} /> : null}
      {step === "H" ? <SectionH card={card} ensure={ensure} register={register} /> : null}
      <div className="mt-auto flex gap-2 border-t border-border pt-3">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => void leave(STEPS[index - 1]!, false)}
          className="btn btn-secondary flex-1"
        >
          {t("wizard.back")}
        </button>
        <button
          type="button"
          onClick={() => void leave(index === STEPS.length - 1 ? "done" : STEPS[index + 1]!, true)}
          className="btn btn-primary flex-1"
        >
          {index === STEPS.length - 1 ? t("wizard.done") : t("wizard.next")}
        </button>
      </div>
    </main>
  );
}
