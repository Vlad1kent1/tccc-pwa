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

4. Apply migrations, then load the sample cards:

```bash
pnpm db:migrate
pnpm db:seed
```

5. Start the client and the API together:

```bash
pnpm dev
```

The client is at [http://localhost:3000](http://localhost:3000). The API is at [http://localhost:4000/api](http://localhost:4000/api), and Swagger is at [http://localhost:4000/api/docs](http://localhost:4000/api/docs).

`pnpm test` runs the Vitest suites in the client, server, and shared package. `pnpm test:e2e` runs the Playwright suite.
