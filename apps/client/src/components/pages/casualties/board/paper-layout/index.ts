import { FluidKind, MedicationCategory } from "@tccc/shared";
import { PAPER_CAPACITY, slotKey, vitalSlotKey } from "@/components/pages/casualties/dd1380/mapping";

/**
 * Which row each printed column of the DD1380 tables shows. A column is bound to a
 * row id, never to a sort position, so editing a time does not move the row out from
 * under the cursor. The layout is built from scratch only when a card is opened
 * (`layoutPaper` without `previous`); later updates keep every pinned row in place.
 */
export interface PaperLayout {
  /** Column key (`vitalSlotKey(n)` or `slotKey(prefix, n)`) to the id of the row shown there. */
  slots: Readonly<Record<string, string>>;
  /** Rows already placed or passed over. Only a row not seen before fills an empty column. */
  seen: ReadonlySet<string>;
}

export const EMPTY_LAYOUT: PaperLayout = { slots: {}, seen: new Set() };

interface PaperRows {
  vitals: readonly { id: string; measuredAt: string }[];
  fluids: readonly { id: string; kind: FluidKind; administeredAt: string | null }[];
  medications: readonly { id: string; category: MedicationCategory; administeredAt: string | null }[];
}

interface PaperTable {
  capacity: number;
  key: (column: number) => string;
  rows: (rows: PaperRows) => { id: string; time: string }[];
}

const FLUID_PREFIX: Record<FluidKind, string> = {
  FLUID: "treatment_C_Fluid",
  BLOOD_PRODUCT: "treatment_C_BloodProduct",
};

const FLUID_CAPACITY: Record<FluidKind, number> = {
  FLUID: PAPER_CAPACITY.fluid,
  BLOOD_PRODUCT: PAPER_CAPACITY.blood,
};

const MEDICATION_PREFIX: Record<MedicationCategory, string> = {
  ANALGESIC: "treatment_MEDS_Analgesic",
  ANTIBIOTIC: "treatment_MEDS_Antibiotic",
  OTHER: "treatment_MEDS_Other",
};

const MEDICATION_CAPACITY: Record<MedicationCategory, number> = {
  ANALGESIC: PAPER_CAPACITY.analgesic,
  ANTIBIOTIC: PAPER_CAPACITY.antibiotic,
  OTHER: PAPER_CAPACITY.otherMedication,
};

/** Column key of vitals column `index` (0-based). */
export function vitalColumn(index: number): string {
  return vitalSlotKey(index + 1);
}

export function fluidColumn(kind: FluidKind, index: number): string {
  return slotKey(FLUID_PREFIX[kind], index + 1);
}

export function medicationColumn(category: MedicationCategory, index: number): string {
  return slotKey(MEDICATION_PREFIX[category], index + 1);
}

/** The printed tables, by the name `PAPER_CAPACITY` uses. */
export type PaperTableName = keyof typeof PAPER_CAPACITY;

function fluidTable(kind: FluidKind): PaperTable {
  return {
    capacity: FLUID_CAPACITY[kind],
    key: (column) => slotKey(FLUID_PREFIX[kind], column),
    rows: (rows) => rows.fluids.filter((row) => row.kind === kind).map((row) => ({ id: row.id, time: row.administeredAt ?? "" })),
  };
}

function medicationTable(category: MedicationCategory): PaperTable {
  return {
    capacity: MEDICATION_CAPACITY[category],
    key: (column) => slotKey(MEDICATION_PREFIX[category], column),
    rows: (rows) =>
      rows.medications.filter((row) => row.category === category).map((row) => ({ id: row.id, time: row.administeredAt ?? "" })),
  };
}

const NAMED_TABLES: Readonly<Record<PaperTableName, PaperTable>> = {
  vitals: {
    capacity: PAPER_CAPACITY.vitals,
    key: (column) => vitalSlotKey(column),
    rows: (rows) => rows.vitals.map((row) => ({ id: row.id, time: row.measuredAt })),
  },
  fluid: fluidTable(FluidKind.FLUID),
  blood: fluidTable(FluidKind.BLOOD_PRODUCT),
  analgesic: medicationTable(MedicationCategory.ANALGESIC),
  antibiotic: medicationTable(MedicationCategory.ANTIBIOTIC),
  otherMedication: medicationTable(MedicationCategory.OTHER),
};

const TABLES: PaperTable[] = Object.values(NAMED_TABLES);

/**
 * Rows of one table the printed card has no column for. The card shows only
 * `PAPER_CAPACITY` rows of each table; anything beyond is still in the digital record.
 */
export function hiddenRows(rows: PaperRows, layout: PaperLayout, table: PaperTableName): number {
  const { capacity, key, rows: list } = NAMED_TABLES[table];
  const ids = new Set(list(rows).map((row) => row.id));
  const shown = new Set<string>();
  for (let column = 1; column <= capacity; column += 1) {
    const id = layout.slots[key(column)];
    if (id && ids.has(id)) shown.add(id);
  }
  return ids.size - shown.size;
}

function chronological<T extends { id: string; time: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

/**
 * Without `previous`: the latest rows of each table that fit, oldest first, which is
 * how the printed card reads. With `previous`: pinned rows keep their columns, a row
 * that is gone frees its column, and only rows not seen before fill free columns.
 */
export function layoutPaper(rows: PaperRows, previous: PaperLayout = EMPTY_LAYOUT): PaperLayout {
  const slots: Record<string, string> = {};
  const seen = new Set<string>();
  for (const table of TABLES) {
    const list = table.rows(rows);
    const present = new Set(list.map((row) => row.id));
    const placed = new Set<string>();
    const free: string[] = [];
    for (let column = 1; column <= table.capacity; column += 1) {
      const key = table.key(column);
      const id = previous.slots[key];
      if (id && present.has(id) && !placed.has(id)) {
        slots[key] = id;
        placed.add(id);
      } else {
        free.push(key);
      }
    }
    const unseen = chronological(list.filter((row) => !placed.has(row.id) && !previous.seen.has(row.id)));
    const shown = free.length === 0 ? [] : unseen.slice(-free.length);
    shown.forEach((row, index) => {
      slots[free[index]!] = row.id;
    });
    for (const row of list) seen.add(row.id);
  }
  return { slots, seen };
}

/** Binds a new row to the column it was typed into, before the row exists. */
export function pinPaperRow(layout: PaperLayout, key: string, id: string): PaperLayout {
  return { slots: { ...layout.slots, [key]: id }, seen: new Set([...layout.seen, id]) };
}

/** Frees the column of a removed row. The row stays seen, so no hidden row moves into it. */
export function unpinPaperRow(layout: PaperLayout, id: string): PaperLayout {
  if (!Object.values(layout.slots).includes(id)) return layout;
  return {
    slots: Object.fromEntries(Object.entries(layout.slots).filter(([, rowId]) => rowId !== id)),
    seen: layout.seen,
  };
}
