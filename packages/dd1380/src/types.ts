import type { BodyView as BodyViewName } from "@tccc/shared";

/** Field values keyed by the field names of the official fillable PDF. */
export type Dd1380Values = Readonly<Record<string, string | boolean>>;

/**
 * Where the sheet reads and writes its values. The context carries this object,
 * which stays the same while the values change, and each field subscribes to its
 * own value. A keystroke then re-renders the one field it changed, not every field
 * and the ~160 injury targets on the figures.
 */
export interface Dd1380FormSource {
  /** The current values; the same object until they change. */
  getValues: () => Dd1380Values;
  subscribe: (listener: () => void) => () => void;
  patch: (changes: Record<string, string | boolean>) => void;
  /** A field gained focus. */
  focus?: (name: string) => void;
  /** A field lost focus. True when the source put a stored value back, so the field shows a hint. */
  blur?: (name: string) => boolean;
}

export interface StoredMark {
  id: string;
  view: BodyViewName;
  x: number;
  y: number;
  /** The printed target this row marks; null for an X placed freely on the figure. */
  siteCode: string | null;
}

