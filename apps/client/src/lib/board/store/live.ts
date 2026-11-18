import { reportInvalidFields, reportSaved } from "@/lib/forms/save-status";
import type { BoardStore } from "./board-store";

/** Every store that may hold unsaved edits, including a new casualty's draft before its card exists. */
export const live = new Set<BoardStore>();

/** The save banner shows every live store: a failure on any card stays visible until it is saved. */
export function publishSaveStatus(): void {
  publishInvalidFields();
  if (![...live].some((store) => store.failed || store.heldFailed)) reportSaved("board");
}

/** The banner's invalid list, re-derived on every store change. `reportInvalidFields` ignores an unchanged list. */
export function publishInvalidFields(): void {
  reportInvalidFields("board", [...new Set([...live].flatMap((store) => store.reportedInvalid()))]);
}
