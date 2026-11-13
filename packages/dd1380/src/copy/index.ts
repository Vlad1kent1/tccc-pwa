import en from "./en.json";
import uk from "./uk.json";

/**
 * Printed labels only. Field names saved to Dexie stay the English PDF keys
 * in either language. Ukrainian follows the app locale code `uk`.
 */
export type CardLocale = "en" | "uk";

export type CardCopy = typeof en;

// Fails to compile when uk.json lacks a key of en.json; the parity test checks the other direction.
const ukCopy: CardCopy = uk;

const translations: Readonly<Record<CardLocale, CardCopy>> = { en, uk: ukCopy };

export function cardCopy(locale: CardLocale): CardCopy {
  return translations[locale];
}

export { translations };
