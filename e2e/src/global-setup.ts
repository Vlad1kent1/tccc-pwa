import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "apps/server/package.json"));

/**
 * Previous runs leave E2E-* cards in the shared database. A fresh browser then
 * spends the whole wait pulling that history, so two-device scenarios time out.
 * Seed cards are kept.
 */
export default async function globalSetup(): Promise<void> {
  const { Client } = require("pg") as { Client: new (config: { connectionString: string }) => {
    connect: () => Promise<void>;
    query: (sql: string) => Promise<unknown>;
    end: () => Promise<void>;
  } };
  const client = new Client({
    connectionString:
      process.env.E2E_DATABASE_URL ?? "postgresql://postgres:password@localhost:5433/tccc_medical_db",
  });
  await client.connect();
  try {
    await client.query(`DELETE FROM "CasualtyCard" WHERE "lastName" LIKE 'E2E-%'`);
  } finally {
    await client.end();
  }
}
