import { Avpu, Route } from "@tccc/shared";

const ROUTE_TO_PDF: Partial<Record<Route, string>> = {
  IM: "IM",
  IV: "IV",
  IO: "IO",
  IN: "IN",
  PO: "PO",
  PR: "PR",
  SC: "SQ",
};

const PDF_TO_ROUTE: Record<string, Route> = {
  IM: Route.IM,
  IV: Route.IV,
  IO: Route.IO,
  IN: Route.IN,
  PO: Route.PO,
  PR: Route.PR,
  SL: Route.OTHER,
  SQ: Route.SC,
};

export function routeToPaper(route: Route | null): string {
  if (!route) return "";
  return ROUTE_TO_PDF[route] ?? "";
}

export function parseAvpu(value: string): Avpu | null {
  const key = value.trim().charAt(0).toUpperCase();
  if (key === "A") return Avpu.ALERT;
  if (key === "V") return Avpu.VERBAL;
  if (key === "P") return Avpu.PAIN;
  if (key === "U") return Avpu.UNRESPONSIVE;
  return null;
}

export function parseRoute(value: string): Route | null {
  return PDF_TO_ROUTE[value.trim().toUpperCase()] ?? null;
}
