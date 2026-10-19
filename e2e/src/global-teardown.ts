import { wipeDatabase } from "./database";

/**
 * Leaves the test database empty. Set E2E_KEEP_DB=1 to keep the rows for
 * inspecting a failed run. Playwright runs this even when global setup failed,
 * and the next setup wipes anyway, so a failure here is only a warning.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DB === "1") return;
  try {
    await wipeDatabase();
  } catch (error) {
    // The whole error: a refused connection is an AggregateError with an empty message.
    console.warn("E2E teardown could not wipe the test database:", error);
  }
}
