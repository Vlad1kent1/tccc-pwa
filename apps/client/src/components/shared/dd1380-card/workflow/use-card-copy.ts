"use client";

import { cardCopy, type CardCopy } from "@tccc/dd1380";
import { useLocale } from "@/i18n/locale";

export type { CardCopy };

/** Follows the locale stored by Settings (`en` | `uk`). */
export function useCardCopy(): CardCopy {
  return cardCopy(useLocale());
}
