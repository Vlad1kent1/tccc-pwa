"use client";

import { useEffect, useRef, useState } from "react";

/** Keeps a text box editable while a saved value arrives from the board store. */
export function useSyncedField(stored: string) {
  const [value, setValue] = useState(stored);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setValue(stored);
  }, [stored]);

  return {
    value,
    setValue,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      if (stored) setValue(stored);
    },
  };
}

/** `null` is empty, `undefined` is out of range. */
export function boundedInt(value: string, min: number, max: number): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  if (n < min || n > max) return undefined;
  return n;
}

/** Edit and new keep a working set. The printed card shows a shorter tail of each table. */
export const MAX_TABLE_ROWS = 10;
