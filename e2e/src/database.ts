import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The `db_test` container from docker-compose.yml (`pnpm db:test:up`), never the
 * dev database on 5433. Each run migrates it and deletes every row in it.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:password@localhost:5434/tccc_medical_db";

interface PgClient {
  connect: () => Promise<void>;
  query: (sql: string) => Promise<unknown>;
  end: () => Promise<void>;
}

function databaseKey(raw: string): string {
  const url = new URL(raw);
  const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "localhost" : url.hostname;
  return `${host}:${url.port || "5432"}${url.pathname}`;
}

/**
 * Refuses to touch the database the dev server uses, whatever E2E_DATABASE_URL says.
 * CI has no apps/server/.env, so there is nothing to compare against there.
 */
function assertNotDevDatabase(): void {
  let env: string;
  try {
    env = readFileSync(path.join(root, "apps/server/.env"), "utf8");
  } catch {
    return;
  }
  const devUrl = /^DATABASE_URL=["']?([^"'\r\n]+)/m.exec(env)?.[1];
  if (devUrl && databaseKey(devUrl) === databaseKey(E2E_DATABASE_URL)) {
    throw new Error(
      `E2E_DATABASE_URL points at the dev database (${databaseKey(devUrl)}). Unset it to use db_test on port 5434.`,
    );
  }
}

/** Applies apps/server/prisma/migrations, so the schema matches the code under test. */
export function migrateDatabase(): void {
  assertNotDevDatabase();
  try {
    execSync("pnpm --filter server exec prisma migrate deploy", {
      cwd: root,
      // prisma.config.ts loads apps/server/.env, but dotenv keeps a variable that is already set.
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
      stdio: "inherit",
    });
  } catch (cause) {
    throw new Error(
      `Migrating the E2E database at ${databaseKey(E2E_DATABASE_URL)} failed. Is it running? Start it with \`pnpm db:test:up\`.`,
      { cause },
    );
  }
}

/** Runs apps/server/prisma/wipe.sql: every row goes, the schema and migration history stay. */
export async function wipeDatabase(): Promise<void> {
  assertNotDevDatabase();
  const require = createRequire(path.join(root, "apps/server/package.json"));
  const { Client } = require("pg") as { Client: new (config: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(readFileSync(path.join(root, "apps/server/prisma/wipe.sql"), "utf8"));
  } finally {
    await client.end();
  }
}
