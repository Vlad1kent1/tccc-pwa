import { ANTERIOR_SITES, POSTERIOR_SITES } from "@/components/pages/casualties/dd1380/injury-sites";

const SITE_CODES = new Set([...ANTERIOR_SITES, ...POSTERIOR_SITES].map((site) => site.id));

/** Tag that rows written before `siteCode` existed put in `description` for an X placed freely on the figure. */
const LEGACY_MARK = "mark:";

/**
 * Injury rows written before `siteCode` existed kept the printed target in the
 * free-text `description` (`Ant_Right_Shoulder`), or `mark:<row id>` for a free X.
 * Moves that into `siteCode` and clears the description. A current row is returned as is.
 */
export function withSiteCode<T extends { siteCode?: string | null; description?: string | null }>(
  row: T,
): T & { siteCode: string | null } {
  if (row.siteCode != null) return row as T & { siteCode: string | null };
  const description = row.description ?? null;
  if (description?.startsWith(LEGACY_MARK)) return { ...row, siteCode: null, description: null };
  if (description && SITE_CODES.has(description)) return { ...row, siteCode: description, description: null };
  return { ...row, siteCode: null };
}
