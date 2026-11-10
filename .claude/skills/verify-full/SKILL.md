---
name: verify-full
description: /verify plus the server API integration suite and the Playwright e2e suite against the isolated db_test database on localhost:5434. Needs Docker; takes about 5 minutes.
disable-model-invocation: true
---

# Full verification

All database work goes to **`db_test` on localhost:5434** and nowhere else. The guard hook blocks any other target.

1. Run every step of `/verify` (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`) and keep the results.
2. Preflight: `docker info`. If Docker is not running, stop the full part and report the `/verify` results only. Tell the user to start Docker Desktop.
3. `pnpm db:test:up` starts the container and waits for it to be healthy.
4. Migrate `db_test`. Set both URLs, because `prisma.config.ts` prefers `DIRECT_URL`:
   `DATABASE_URL=postgresql://postgres:password@localhost:5434/tccc_medical_db DIRECT_URL=postgresql://postgres:password@localhost:5434/tccc_medical_db pnpm --filter server exec prisma migrate deploy`
5. Server API integration tests. The specs hard-code port 5434:
   `pnpm --filter server test:e2e`
6. Playwright. It builds the client into `.next-e2e` and starts the API on :4100 and the client on :3100. It takes about 4 minutes, so use a long timeout or run it in the background:
   `DIRECT_URL=postgresql://postgres:password@localhost:5434/tccc_medical_db pnpm --filter e2e test`
7. **Never run `pnpm --filter e2e report`.** It overwrites the tracked `e2e/results/summary.*` and `docs/test-report.md`.
8. Run `git status --short`. The runs must not change tracked files. Report it if they did.

## Report
Use the `/verify` table plus rows for "API e2e" and "Playwright":
- give passed, failed and skipped counts, and the names of failing tests;
- Playwright currently skips about 23 tests (manual placeholders and WebKit offline cases, see P2-028). A skip count in that range is expected.
