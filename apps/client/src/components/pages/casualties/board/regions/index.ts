import { BodyView, type BodyRegion, type BodyView as BodyViewName } from "@tccc/shared";
import { regionFor } from "@/components/pages/casualties/dd1380/mapping";
import { ANTERIOR_SITES, POSTERIOR_SITES, type InjurySite } from "@/components/pages/casualties/dd1380/injury-sites";

const FRONT_BOX = { x0: 120.6, y0: 231.85, x1: 221.4, y1: 458.65 };
const BACK_BOX = { x0: 295.2, y0: 231.85, x1: 396, y1: 458.65 };

export interface RegionHit {
  region: BodyRegion;
  view: BodyViewName;
  left: number;
  top: number;
  width: number;
  height: number;
}

function hits(sites: readonly InjurySite[], box: typeof FRONT_BOX, view: BodyViewName): RegionHit[] {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const groups = new Map<BodyRegion, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const site of sites) {
    const region = regionFor(site.id);
    const x = ((site.x - box.x0) / width) * 100;
    const y = ((site.y - box.y0) / height) * 100;
    const group = groups.get(region) ?? { minX: x, minY: y, maxX: x, maxY: y };
    group.minX = Math.min(group.minX, x);
    group.minY = Math.min(group.minY, y);
    group.maxX = Math.max(group.maxX, x);
    group.maxY = Math.max(group.maxY, y);
    groups.set(region, group);
  }
  return [...groups].map(([region, group]) => {
    let left = group.minX - 4;
    let top = group.minY - 2;
    let hitWidth = group.maxX - group.minX + 8;
    let hitHeight = group.maxY - group.minY + 4;
    if (hitWidth < 16) {
      left -= (16 - hitWidth) / 2;
      hitWidth = 16;
    }
    if (hitHeight < 8) {
      top -= (8 - hitHeight) / 2;
      hitHeight = 8;
    }
    left = Math.max(0, Math.min(left, 84));
    top = Math.max(0, Math.min(top, 92));
    return {
      region,
      view,
      left,
      top,
      width: Math.min(hitWidth, 100 - left),
      height: Math.min(hitHeight, 100 - top),
    };
  });
}

export const FRONT_HITS = hits(ANTERIOR_SITES, FRONT_BOX, BodyView.FRONT);
export const BACK_HITS = hits(POSTERIOR_SITES, BACK_BOX, BodyView.BACK);

export function sitesFor(region: BodyRegion, view: BodyViewName): readonly InjurySite[] {
  const sites = view === BodyView.FRONT ? ANTERIOR_SITES : POSTERIOR_SITES;
  return sites.filter((site) => regionFor(site.id) === region);
}

export function siteLabel(label: string): string {
  return label.match(/"([^"]+)"/)?.[1] ?? label;
}

export function figureFor(view: BodyViewName): { x0: number; y0: number; w: number; h: number } {
  return view === BodyView.FRONT
    ? { x0: FRONT_BOX.x0, y0: FRONT_BOX.y0, w: FRONT_BOX.x1 - FRONT_BOX.x0, h: FRONT_BOX.y1 - FRONT_BOX.y0 }
    : { x0: BACK_BOX.x0, y0: BACK_BOX.y0, w: BACK_BOX.x1 - BACK_BOX.x0, h: BACK_BOX.y1 - BACK_BOX.y0 };
}
