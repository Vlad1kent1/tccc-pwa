# TCCC Casualty Card (tccc-pwa)

Offline-first PWA for the TCCC Casualty Card (DD Form 1380), used by field medics on phones over flaky or absent networks. The UI is in English and Ukrainian. Every card holds **clinical data and PII**.

Stack: Next.js 16 + React 19 PWA (Serwist, Dexie/IndexedDB), a NestJS 12 API (Prisma 7, PostgreSQL), shared Zod contracts, and Playwright e2e. Package manager: pnpm workspaces.

## Layout
```
apps/client/      Next.js PWA. UI, Dexie store, sync engine, service worker  → apps/client/CLAUDE.md
apps/server/      NestJS API. Sync push/pull/resolve, REST, Prisma           → apps/server/CLAUDE.md
packages/shared/  @tccc/shared: Zod schemas, HLC, conflict policy (client↔server contract) → packages/shared/CLAUDE.md
e2e/              Playwright offline/sync scenarios (T-01…T-15), chaos middleware, metrics
docs/             requirements, data model, test report (thesis artefacts)
```
Data flow: UI edit → `BoardStore` (400 ms debounce) → `casualtyRepo` (one Dexie transaction: card + HLC tick + one outbox entry) → sync engine (Web Lock) → `POST /api/sync/push` (one DB transaction per mutation, LWW merge, `ProcessedMutation` dedup) → `GET /api/sync/pull?since=<changeSeq>` → `rebaseCard` → Dexie → `useLiveQuery` → UI.

## Commands (run from the repo root)
| Purpose | Command |
|---|---|
| Install | `pnpm install` (also builds `@tccc/shared`) |
| Prisma client | `pnpm --filter server exec prisma generate` |
| Dev (client + API) | `pnpm db:up` then `pnpm dev`. Run `pnpm --filter @tccc/shared dev` alongside when editing shared. |
| Type check (all) | `pnpm typecheck` (builds shared `dist` first) |
| Lint (all) | `pnpm lint` (client ESLint + server oxlint) |
| Format check | `pnpm format:check` (server Prettier) |
| Unit tests (all) | `pnpm test` |
| One package | `pnpm --filter <client\|server\|@tccc/shared\|e2e> <typecheck\|lint\|test\|build>` |
| Server API tests | `pnpm db:test:up`, then migrate `db_test`, then `pnpm --filter server test:e2e` (see `/verify-full`) |
| Playwright | `pnpm test:e2e` (Docker; builds the client into `.next-e2e`; about 4 min) |
| Everything | `/verify` (static checks + unit tests), `/verify-full` (+ API e2e + Playwright) |

## Database rules
- Local dev uses Docker `db` on **localhost:5433**, which is where `apps/server/.env` points. Tests use Docker `db_test` on **localhost:5434** only.
- The deployed database is **Neon**. Never target it from a dev machine or from Claude.
- Never read `apps/server/.env` or any `.env*` except `.env.example`. Settings and hooks block this.
- `.claude/hooks/guard-command.mjs` denies prisma, seed, wipe and server-start commands whose effective DB host is not localhost. Pass an inline `DATABASE_URL=postgresql://…@localhost:<port>/…` when in doubt.
- Never run `pnpm db:wipe`, `pnpm db:seed:mock`, `prisma migrate reset` or `pnpm --filter e2e report`. The last one overwrites the tracked thesis results. All four are denied.

## Domain safety rules (always top priority)
1. **No casualty data loss or silent overwrite.** That covers local edits, the outbox, sync merges, conflict resolution and service-worker reloads.
2. **No wrong clinical times.** Tourniquet, injury, vitals, fluid and medication times must never shift silently. Treat a wrong time like data loss.
3. **No PII in logs, caches or error responses.** Payload logging only goes through `payloadLoggingEnabled()`. The service worker never caches API traffic.
4. Any change to **sync, merge, outbox, rebase, HLC or time parsing** needs a regression test that fails before the fix.
5. Wire or schema changes must stay compatible with installed PWAs running older code (see `packages/shared/CLAUDE.md`). Ask before changing them.
6. A failure the user can't see is a bug. Show it in the save banner or the sync status, and never swallow it.

## Fragile areas (read the code and tests before touching)
1. Time anchoring: `apps/client/src/lib/forms/time.ts`, `board/rows`, `board/tourniquet-panel`, `board/stamp-field`. Keystroke-level parsing (P0-001).
2. `BoardStore` hydrate state machine and `commitBoard`'s "delete what is not in the draft" (`board/store`, `board/commit`).
3. Outbox rewriters: `coalesceOutbox`, `commitRebase`, `queuedAfterDecision`, together with `rebaseCard`'s newer-local-clock-wins rule (`lib/sync/*`).
4. `nextChangeSeq` (`apps/server/src/prisma/change-seq.ts`) must be the last statement before every card write. Nothing else may set `changeSeq`.
5. Strict pull parsing combined with long-lived cached PWAs (`lib/sync/api.ts`, `packages/shared/src/schemas`). See P1-001.
6. Service-worker lifecycle: `app/sw.ts`, `app/sw-navigation.ts`, `app/serwist/[path]/route.ts`, the update banner, and the `SerwistProvider` defaults.
7. The e2e helper layer (`e2e/src/app.ts`) and the metrics pipeline that feeds `docs/test-report.md`.
8. Destructive DB scripts (`db:wipe`, `db:seed:mock`, `db:migrate`) have no localhost guard for humans (P1-008).

## Working on findings
- The prioritized backlog (69 findings, P0–P3) is `CODE_REVIEW.md` at the repo root.
  - It is a **local, gitignored file** that may be missing in a checkout. Never stage or commit it.
  - Finding IDs such as P0-001 in the CLAUDE.md files refer to it.
- When the file exists, fix one finding per branch with `/fix-finding <ID>`. After merging, record the fix with `/mark-fixed <ID> <hash>`, which edits only the local file.
- Review a diff with `/review-diff`. The `sync-reviewer` subagent reviews diffs in `lib/sync`, `lib/db`, `apps/server/src/{sync,prisma}` and `packages/shared`.
- Keep fixes minimal and don't reformat unrelated code.

## Current tooling state
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` all pass on `main`. Treat any failure as a regression.
- CI (`.github/workflows/test.yml`) runs three jobs on Node 24 (`engines.node` is `>=24`):
  - `checks`: typecheck, lint and format check;
  - `unit-and-api`: unit tests and the server API suite;
  - `e2e`: Playwright, uploading results and traces as an artifact.
- Client `typecheck` runs `next typegen` first, so it works on a clean checkout without `next-env.d.ts` or `.next`.
- Server files are Prettier-formatted. The edit hook runs `prettier --write` on a server file only if it was clean at HEAD.
- `.gitattributes` stores text with LF. On Windows (`core.autocrlf=true`), files checked out before it may still have CRLF in the working tree; git normalizes them on commit.

## Git
- Conventional Commits: `type(scope): description`.
  - Types: `feat|fix|chore|docs|test|refactor|style`.
  - Scopes: `client`, `server`, `shared`, `e2e`. Omit the scope only for repo-wide changes.
- Never push, force-push, `reset --hard`, `clean -f` or drop stashes. Branch off `main` for every fix.

## Reference docs (read on demand)
- `CODE_REVIEW.md` (local, gitignored, may be missing): findings, fix order, project profile (§6)
- `docs/requirements.md`: use cases, FR/NFR, test IDs
- `docs/data-model.md`: server schema, Dexie tables, sync metadata
- `docs/test-report.md`: e2e results (generated; T-10 timings are known to be invalid, P1-009)
- `PLAN.md`: original engineering roadmap
