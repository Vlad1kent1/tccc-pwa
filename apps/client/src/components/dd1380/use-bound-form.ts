"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BodyView,
  FluidKind,
  MedicationCategory,
  type CardPatch,
} from "@tccc/shared";
import { casualtyRepo, type LocalCasualtyCard } from "@/lib/db";
import type { Dd1380Values } from "./form-context";
import {
  cardToValues,
  intField,
  limbSlots,
  markedSites,
  parseAvpu,
  parseCardStamp,
  parsePain,
  parseRoute,
  parseVolume,
  pulseParts,
  str,
  valuesToCardPatch,
} from "./mapping";

export function useBoundDd1380(card: LocalCasualtyCard) {
  const [values, setValues] = useState(() => cardToValues(card));
  const cardRef = useRef(card);
  cardRef.current = card;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setValues(cardToValues(card));
  }, [card.id]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = useCallback((next: Dd1380Values) => {
    setValues(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persistForm(cardRef.current, next);
    }, 400);
  }, []);

  return { values, onChange };
}

async function persistForm(card: LocalCasualtyCard, values: Dd1380Values): Promise<void> {
  const patch = valuesToCardPatch(values);
  const changed = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => JSON.stringify(card[key as keyof CardPatch]) !== JSON.stringify(value)),
  ) as CardPatch;
  if (Object.keys(changed).length > 0) {
    await casualtyRepo.updateFields(card.id, changed);
  }
  await persistTourniquets(card, values);
  await persistVitals(card, values);
  await persistFluids(card, values);
  await persistMeds(card, values);
  await persistInjuries(card, values);
}

async function persistTourniquets(card: LocalCasualtyCard, values: Dd1380Values): Promise<void> {
  for (const slot of limbSlots(values)) {
    const existing = card.tourniquets.find((row) => row.limb === slot.limb && row.deletedAt == null);
    if (!slot.type) {
      if (existing) await casualtyRepo.deleteChild(card.id, "tourniquet", existing.id);
      continue;
    }
    const appliedAt = parseCardStamp("", slot.time, existing?.appliedAt ?? card.injuredAt) ?? new Date().toISOString();
    if (existing && existing.type === slot.type && existing.appliedAt === appliedAt) continue;
    await casualtyRepo.upsertChild(card.id, "tourniquet", { limb: slot.limb, type: slot.type.slice(0, 50), appliedAt });
  }
}

async function persistVitals(card: LocalCasualtyCard, values: Dd1380Values): Promise<void> {
  const existing = [...card.vitalSigns.filter((row) => row.deletedAt == null)].sort((a, b) =>
    a.measuredAt.localeCompare(b.measuredAt),
  );
  for (let i = 0; i < 4; i++) {
    const n = i + 1;
    const pulse = pulseParts(str(values[`pulse${n}`]));
    const systolic = intField(str(values[`bloodPressureA${n}`]), 0, 300);
    const diastolic = intField(str(values[`bloodPressureB${n}`]), 0, 200);
    const respiratoryRate = intField(str(values[`respRate${n}`]), 0, 80);
    const spo2 = intField(str(values[`o2sat${n}`]), 0, 100);
    const avpu = parseAvpu(str(values[`avpu${n}`]));
    const painScale = parsePain(str(values[`pain${n}`]));
    const has = [pulse.pulseRate, pulse.pulseLocation, systolic, diastolic, respiratoryRate, spo2, avpu, painScale].some(
      (item) => item != null && item !== "",
    );
    const row = existing[i];
    if (!has) {
      if (row) await casualtyRepo.deleteChild(card.id, "vitalSigns", row.id);
      continue;
    }
    const measuredAt = parseCardStamp("", str(values[`time${n}`]), row?.measuredAt ?? card.injuredAt) ?? new Date().toISOString();
    await casualtyRepo.upsertChild(card.id, "vitalSigns", {
      id: row?.id,
      measuredAt,
      pulseRate: pulse.pulseRate,
      pulseLocation: pulse.pulseLocation,
      systolic,
      diastolic,
      respiratoryRate,
      spo2,
      avpu,
      painScale,
    });
  }
}

async function persistFluids(card: LocalCasualtyCard, values: Dd1380Values): Promise<void> {
  const kinds = [
    { kind: FluidKind.FLUID, prefix: "treatment_C_Fluid", slots: 2 },
    { kind: FluidKind.BLOOD_PRODUCT, prefix: "treatment_C_BloodProduct", slots: 2 },
  ] as const;
  for (const group of kinds) {
    const existing = card.fluids.filter((row) => row.deletedAt == null && row.kind === group.kind);
    for (let i = 0; i < group.slots; i++) {
      const n = i + 1;
      const name = str(values[`${group.prefix}_Name${n}`]).trim();
      const volumeMl = parseVolume(str(values[`${group.prefix}_Volume${n}`]));
      const route = parseRoute(str(values[`${group.prefix}_Route${n}`]));
      const row = existing[i];
      if (!name || volumeMl == null || !route) {
        if (row) await casualtyRepo.deleteChild(card.id, "fluid", row.id);
        continue;
      }
      const administeredAt =
        parseCardStamp("", str(values[`${group.prefix}_Time${n}`]), row?.administeredAt ?? card.injuredAt) ??
        new Date().toISOString();
      await casualtyRepo.upsertChild(card.id, "fluid", {
        id: row?.id,
        kind: group.kind,
        name: name.slice(0, 100),
        volumeMl,
        route,
        administeredAt,
      });
    }
  }
}

async function persistMeds(card: LocalCasualtyCard, values: Dd1380Values): Promise<void> {
  const groups = [
    { category: MedicationCategory.ANALGESIC, prefix: "treatment_MEDS_Analgesic", slots: 3 },
    { category: MedicationCategory.ANTIBIOTIC, prefix: "treatment_MEDS_Antibiotic", slots: 2 },
    { category: MedicationCategory.OTHER, prefix: "treatment_MEDS_Other", slots: 2 },
  ] as const;
  for (const group of groups) {
    const existing = card.medications.filter((row) => row.deletedAt == null && row.category === group.category);
    for (let i = 0; i < group.slots; i++) {
      const n = i + 1;
      const name = str(values[`${group.prefix}_Name${n}`]).trim();
      const dose = str(values[`${group.prefix}_Dose${n}`]).trim();
      const route = parseRoute(str(values[`${group.prefix}_Route${n}`]));
      const row = existing[i];
      if (!name || !dose || !route) {
        if (row) await casualtyRepo.deleteChild(card.id, "medication", row.id);
        continue;
      }
      const administeredAt =
        parseCardStamp("", str(values[`${group.prefix}_Time${n}`]), row?.administeredAt ?? card.injuredAt) ??
        new Date().toISOString();
      await casualtyRepo.upsertChild(card.id, "medication", {
        id: row?.id,
        category: group.category,
        name: name.slice(0, 100),
        dose: dose.slice(0, 50),
        route,
        administeredAt,
      });
    }
  }
}

async function persistInjuries(card: LocalCasualtyCard, values: Dd1380Values): Promise<void> {
  const marked = markedSites(values);
  const existing = card.injurySites.filter((row) => row.deletedAt == null);
  const wanted = new Set(marked.map((site) => site.id));
  for (const row of existing) {
    if (row.description && !wanted.has(row.description)) {
      await casualtyRepo.deleteChild(card.id, "injurySite", row.id);
    }
  }
  for (const site of marked) {
    const row = existing.find((item) => item.description === site.id);
    if (row) continue;
    const figure = site.view === BodyView.FRONT ? { x0: 120.6, y0: 231.85, w: 100.8, h: 226.8 } : { x0: 295.2, y0: 231.85, w: 100.8, h: 226.8 };
    await casualtyRepo.upsertChild(card.id, "injurySite", {
      region: site.region,
      view: site.view,
      x: Math.min(1, Math.max(0, (site.x - figure.x0) / figure.w)),
      y: Math.min(1, Math.max(0, (site.y - figure.y0) / figure.h)),
      description: site.id,
    });
  }
}
