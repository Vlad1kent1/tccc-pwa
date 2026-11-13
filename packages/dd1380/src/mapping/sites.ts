import { BodyRegion, BodyView } from "@tccc/shared";
import { ANTERIOR_SITES, POSTERIOR_SITES } from "../injury-sites";
import type { Dd1380Values } from "../types";
import { on } from "./values";

const ALL_SITES = [...ANTERIOR_SITES, ...POSTERIOR_SITES];
const PAPER_SITE_IDS = new Set(ALL_SITES.map((site) => site.id));

export function isPaperSite(id: string | null | undefined): boolean {
  return id != null && PAPER_SITE_IDS.has(id);
}

export function markedSites(values: Dd1380Values): Array<{
  id: string;
  region: BodyRegion;
  view: (typeof BodyView)[keyof typeof BodyView];
  x: number;
  y: number;
}> {
  return ALL_SITES.filter((site) => on(values, site.id)).map((site) => ({
    id: site.id,
    region: regionFor(site.id),
    view: POSTERIOR_SITES.some((item) => item.id === site.id) ? BodyView.BACK : BodyView.FRONT,
    x: site.x,
    y: site.y,
  }));
}

export function regionFor(id: string): BodyRegion {
  if (/Head|Nose|Mouth|Chin|Eye|Ear|Cheek/.test(id)) {
    if (/Eye|Ear|Nose|Mouth|Chin|Cheek/.test(id)) return BodyRegion.FACE;
    return BodyRegion.HEAD;
  }
  if (/Neck/.test(id)) return BodyRegion.NECK;
  if (/Right_.*(?:Arm|Bicep|Elbow|Forearm|Wrist|Palm|Hand|Thumb|Fingers|Shoulder)/.test(id) || /Ant_Right_Shoulder|Post_Right_Shoulder|Right_Palm|Right_Hand/.test(id)) {
    return BodyRegion.RIGHT_ARM;
  }
  if (/Left_.*(?:Arm|Bicep|Elbow|Forearm|Wrist|Palm|Hand|Thumb|Fingers|Shoulder)/.test(id) || /Ant_Left_Shoulder|Post_Left_Shoulder|Left_Palm|Left_Hand/.test(id)) {
    return BodyRegion.LEFT_ARM;
  }
  if (/Right_.*(?:Thigh|Leg|Knee|Ankle|Foot|Heel|Toe)/.test(id) || /Right_Heel/.test(id)) return BodyRegion.RIGHT_LEG;
  if (/Left_.*(?:Thigh|Leg|Knee|Ankle|Foot|Heel|Toe)/.test(id) || /Left_Heel/.test(id)) return BodyRegion.LEFT_LEG;
  if (/Chest|Sternum|Axillary/.test(id)) return BodyRegion.CHEST;
  if (/UQ|LQ|Flank/.test(id)) return BodyRegion.ABDOMEN;
  if (/Pelvis|Groin|Hip|Genitals|Buttock|Tail/.test(id)) return BodyRegion.PELVIS;
  if (/Upper_Back/.test(id)) return BodyRegion.UPPER_BACK;
  if (/Middle_Back|Lower_Back|Spine/.test(id) || /Back/.test(id)) return BodyRegion.LOWER_BACK;
  return BodyRegion.CHEST;
}
