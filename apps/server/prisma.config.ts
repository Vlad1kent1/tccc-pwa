import "dotenv/config";
import { defineConfig } from "prisma/config";

const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for Prisma migrations");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  // No `seed` entry on purpose: no Prisma command may load the mock cards in
  // prisma/seed.ts. They load only through an explicit `pnpm db:seed:mock`.
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
