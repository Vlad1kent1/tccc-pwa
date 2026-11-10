# Shared contracts (packages/shared, `@tccc/shared`)

This package is the client↔server contract:
- Zod schemas for the card aggregate and the sync wire format (`src/schemas/`);
- the HLC (`src/hlc.ts`);
- the conflict policy, UUIDv7 ids and enums.

## Build
- Consumers import the built **`dist/`**, not `src/`. After a change, run `pnpm --filter @tccc/shared build` (or keep `pnpm --filter @tccc/shared dev` running). Otherwise client and server type-check against a stale `dist`.
- `pnpm typecheck` at the root builds shared first.
- NodeNext and `verbatimModuleSyntax` apply: relative imports use `.js`, and type-only imports use `import type`.

## Compatibility rules (cached PWAs)
Installed PWAs run old code for days while offline (`skipWaiting: false`), and they parse server responses **strictly** (`pullResponseSchema`, `pushResponseSchema`). One response a client cannot parse stops its sync entirely (P1-001). Therefore:
- Only **additive** changes. A new field must be optional or have a default that old clients can ignore.
- Never remove or rename a field. Never remove an enum value.
- Never tighten validation that existing stored data might fail.
- **Adding an enum value, changing a refinement, or changing a mutation, push, pull or resolve shape or the HLC string format is a protocol change. Stop and ask** before making it. It needs a coordinated server, client and migration plan.
- `card.ts` field lists drive hand-kept lists on the client (board store, commit, dd1380 mapping) and the server (`CHILD_DATE_FIELDS`). Update every consumer in the same change.

## Tests
- Run `pnpm --filter @tccc/shared test` (Vitest, `src/**/*.test.ts`) and `pnpm --filter @tccc/shared typecheck`.
- Every schema or HLC change needs a test that pins the old wire format, so existing data and older clients keep parsing.
