import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // No `seed` entry on purpose: no Prisma command may load the mock cards in
  // prisma/seed.ts. They load only through an explicit `pnpm db:seed:mock`.
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
