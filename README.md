# TCCC Casualty Card

Offline-first progressive web app for DD Form 1380 casualty records. The client is a Next.js app in `apps/client`. The API is a NestJS app in `apps/server`. Shared schemas live in `packages/shared`.

## Getting started

Requirements: Node.js, pnpm, and Docker.

1. Install workspace dependencies from the repository root:

```bash
pnpm install
```

2. Create local environment files from the examples:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/client/.env.example apps/client/.env.local
```

`apps/server/.env` points PostgreSQL at host port **5433**. That matches `docker-compose.yml`: port 5432 is left for a native PostgreSQL install. The client file sets `NEXT_PUBLIC_API_URL=http://localhost:4000/api`.

3. Start the database:

```bash
pnpm db:up
```

4. Apply migrations. The database starts empty:

```bash
pnpm db:migrate
```

Mock data is opt-in. `pnpm db:seed:mock` loads 20 sample cards. `pnpm db:wipe` deletes every casualty card, sync record, and device from the server database and keeps the schema. A browser that already synced keeps its own copy, so reset it as well (Settings → Clear local cards, or the dev tools reset below).

The Settings page shows a dev tools panel (generate 30 local mock cards, reset this browser's database) only when `apps/client/.env` sets `NEXT_PUBLIC_DEV_TOOLS=true`.

5. Start the client and the API together:

```bash
pnpm dev
```

The client is at [http://localhost:3000](http://localhost:3000). The API is at [http://localhost:4000/api](http://localhost:4000/api), and Swagger is at [http://localhost:4000/api/docs](http://localhost:4000/api/docs).

`pnpm test` runs the Vitest suites in the client, server, and shared package. `pnpm test:e2e` runs the Playwright suite against the `db_test` container on port 5434, never the dev database. It starts the container, applies the migrations, and empties the database before the run and again after it. Set `E2E_KEEP_DB=1` to keep the rows after a run for debugging.
