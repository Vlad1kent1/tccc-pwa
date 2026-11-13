# @tccc/dd1380 (packages/dd1380)

Plain TypeScript for the DD Form 1380 paper card: board ⇄ paper field mapping, the card's date/time formatting and parsing, injury-site codes and figure regions, paper-table layout, and the printed-card copy (`src/copy/en.json`, `src/copy/uk.json`).

## Rules
- **No React, no DOM, no client imports.** Depend only on `@tccc/shared`. Hooks and components that use this package live in `apps/client`.
- **The server must not depend on this package.** It is client-only domain logic.
- **No clock.** Anything that needs "now" stays in the client. `parseCardStamp` and `valuesToCardPatch` live in `apps/client/src/lib/board/card-stamp.ts`, because a time without a date is placed by `timeTokenToIso` on the server-corrected network clock.
- **Consumed as source:** `exports` points at `src/index.ts`, and the client lists it in `transpilePackages`. There is no build step.
- **`sideEffects: false`:** module top level must stay pure (constant tables only), so bundlers can drop unused modules. The service worker reaches the package through `lib/db/injury-site-code.ts`.
- **Public API:** export by name from `src/index.ts` only; no `export *`. Consumers import from `@tccc/dd1380`, never from a file path inside it.
- **Copy:** `en.json` and `uk.json` must have the same keys. The type check (`uk` must satisfy `CardCopy`) and `src/copy/__tests__/copy.test.ts` enforce it. Field names saved to Dexie stay the English PDF keys; only printed labels are translated.
- **Injury-site codes** (`injury-sites.ts`) are stored in `siteCode` and read by the Dexie v4 migration (`apps/client/src/lib/db/injury-site-code.ts`). Never rename or remove a code.
- **Size and tests:** files stay under 300 lines (ESLint `max-lines`, `error`). Tests live in `__tests__/` next to the code.

## Commands
`pnpm --filter @tccc/dd1380 <typecheck|lint|test>`. The root `pnpm typecheck`, `pnpm lint` and `pnpm test` include it.
