# Server (apps/server)

NestJS 12 on Express. ESM (`"type": "module"`). Prisma 7 with `@prisma/adapter-pg`. Zod validation.

## Conventions
- **ESM imports:** relative imports need an explicit `.js` suffix, e.g. `import { X } from './x.js'`.
- **Validation:** every `@Body()`/`@Query()` type is a DTO class with `static schema = <zod schema>`, which the global `ZodValidationPipe` reads. A parameter without a schema is passed through **unvalidated**, so always add one.
- **Auth:** the global `UnitTokenGuard` is deny-by-default. Use `@Public()` only for routes that carry no casualty data (e.g. health).
- **Errors:** throw Nest `HttpException`s. `AllExceptionsFilter` maps Prisma errors through `prisma/prisma-errors.ts`.
- **Logging:** casualty data (bodies, query strings, params) is logged only behind `payloadLoggingEnabled()` (`common/error-log.ts`). Never return raw DB messages to clients.
- **Style:** Prettier (single quotes, trailing commas) and oxlint `--type-aware` with `no-floating-promises` as an error.

## Sync invariants (`src/sync/`, `src/prisma/`)
- Push applies **one transaction per mutation**. `ProcessedMutation` makes a replayed `mutationId` return the stored result, including the concurrent P2002 path. Keep push idempotent.
- **`nextChangeSeq(tx)` is the last call before the card write.** Only the card write and the `ProcessedMutation` insert may follow it. Never set `changeSeq` any other way, or pulls skip cards (`src/prisma/change-seq.ts`).
- Lock order is card row (`FOR UPDATE`), then device row, then the changeSeq advisory lock. Do not invert it.
- Merging is last-writer-wins by HLC (`src/sync/merge.ts`). A replaced value from a different writer becomes a `SyncConflict`.
- REST `casualties` endpoints are a second write model. Changes there must keep sync invariants (field clocks, tombstones, `nextChangeSeq`); see P2-007.

## Prisma
- The generated client lives in `src/generated/prisma` (gitignored). Never edit it. Regenerate with `pnpm --filter server exec prisma generate`.
- Never edit an applied migration under `prisma/migrations/`. Add a new one with an **inline localhost URL**, e.g. `DATABASE_URL=postgresql://postgres:password@localhost:5433/tccc_medical_db pnpm --filter server exec prisma migrate dev --name <name>`. The guard hook blocks non-localhost targets.
- `prisma.config.ts` uses `DIRECT_URL || DATABASE_URL` for migrations. Set both when overriding.
- Schema and migration changes are protocol changes: ask first.

## Tests
- Unit tests are `src/**/*.spec.ts`: `pnpm --filter server test`.
- API integration tests are `test/*.e2e-spec.ts` and hard-code `db_test` on localhost:5434: `pnpm --filter server test:e2e`. Migrate `db_test` first (see `/verify-full`).
- Also run `pnpm --filter server typecheck`, `pnpm --filter server lint` and `pnpm --filter server format:check`.
