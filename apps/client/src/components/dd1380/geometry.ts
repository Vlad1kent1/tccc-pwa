import type { CSSProperties } from "react";

/**
 * All geometry is in PDF points measured from the top-left corner of the official
 * DD Form 1380 page. The frame crops the letter page to everything printed on either
 * side (page 1's distribution block sets the right edge), so both sides share one scale.
 */
export const FRAME = { x: 26, y: 26, width: 428, height: 614 } as const;

/** Distance from the top of a `line-height: 1` box to the Arial baseline, in em. */
const ARIAL_BASELINE = 0.8465;

/** A length of `value` PDF points at the sheet's current scale. */
export function pt(value: number): string {
  return `calc(var(--pt) * ${Math.round(value * 1000) / 1000})`;
}

/** Absolute placement for a PDF rectangle given by its corners. */
export function rect(x0: number, y0: number, x1: number, y1: number): CSSProperties {
  return {
    left: pt(x0 - FRAME.x),
    top: pt(y0 - FRAME.y),
    width: pt(x1 - x0),
    height: pt(y1 - y0),
  };
}

/** Absolute placement for text whose PDF origin (left edge, baseline) is (x, baseline). */
export function textOrigin(x: number, baseline: number, size: number): CSSProperties {
  return {
    left: pt(x - FRAME.x),
    top: pt(baseline - FRAME.y - size * ARIAL_BASELINE),
    fontSize: pt(size),
  };
}
