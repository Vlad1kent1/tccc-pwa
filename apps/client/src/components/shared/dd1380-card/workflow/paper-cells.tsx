"use client";

import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { FluidKind, MedicationCategory } from "@tccc/shared";
import type { PaperTableName } from "@tccc/dd1380";

/**
 * The editable cells of the printed tables (vitals, fluids, medications) and the note
 * under a table with more rows than the paper has room for. The page that shows the
 * card supplies them, so the card does not depend on where those rows are stored.
 * Pass a module-level object: a new object on every render re-renders the whole card.
 */
export interface PaperCells {
  VitalInput: ComponentType<{
    index: number;
    field: "time" | "pulse" | "location" | "systolic" | "diastolic" | "respiratory" | "spo2" | "pain";
  }>;
  VitalSelect: ComponentType<{ index: number; field: "avpu" | "pain" }>;
  FluidInput: ComponentType<{ kind: FluidKind; index: number; field: "name" | "volume" | "time" }>;
  FluidRoute: ComponentType<{ kind: FluidKind; index: number }>;
  MedicationInput: ComponentType<{ category: MedicationCategory; index: number; field: "name" | "dose" | "time" }>;
  MedicationRoute: ComponentType<{ category: MedicationCategory; index: number }>;
  Overflow: ComponentType<{ tables: readonly PaperTableName[] }>;
}

const PaperCellsContext = createContext<PaperCells | null>(null);

export function PaperCellsProvider({ cells, children }: { cells: PaperCells; children: ReactNode }) {
  return <PaperCellsContext.Provider value={cells}>{children}</PaperCellsContext.Provider>;
}

export function usePaperCells(): PaperCells {
  const cells = useContext(PaperCellsContext);
  if (!cells) throw new Error("DD1380 tables must render inside PaperCellsProvider");
  return cells;
}
