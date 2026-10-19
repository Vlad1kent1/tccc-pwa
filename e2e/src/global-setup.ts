import { migrateDatabase, wipeDatabase } from "./database";

/**
 * Brings the test database to the current schema and empties it, so every run
 * starts from zero cards and a fresh browser has no history to pull. Playwright
 * starts the web servers first; the API only needs the schema once tests run.
 */
export default async function globalSetup(): Promise<void> {
  migrateDatabase();
  await wipeDatabase();
}
