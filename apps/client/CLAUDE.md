# Client (apps/client)

Next.js 16 App Router PWA with React 19, Turbopack, Serwist, Dexie and Tailwind 4.

**Next.js 16 differs from older versions.** Before using an App Router, caching or config API you are unsure about, read the bundled guide in `node_modules/next/dist/docs/` and follow its deprecation notices.

## Component architecture
A refactor into this layout is in progress. `components/pages/casualties/**` and `components/dd1380` have not been migrated yet; don't copy their layout. `pnpm --filter client lint` enforces the rules: ESLint for imports and size, `scripts/check-structure.mjs` for folders. During the migration, `check-structure` fails only under its `MIGRATED` paths and warns elsewhere.

- **`src/app` is for routing only:** `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`, plus `sw.ts`, `manifest.ts`, `globals.css` and the icons. Each `page.tsx` renders one component from `components/pages/` and holds only route concerns such as `metadata` and `Suspense`.
- **`src/components` has exactly four folders:**
  - `layout/`: app-wide shell parts (app shell, banners, connectivity indicator).
  - `pages/<page>/`: one folder per route-level page, e.g. `pages/settings/`.
  - `shared/`: domain components used by more than one page (e.g. the DD1380 paper card, sync badge).
  - `ui/`: generic presentational components with no domain logic: no `@tccc/shared` enums, no `lib/db` or `lib/sync`.
- **Each component is a kebab-case folder** named after the component, with the component in `index.tsx`. Inside it:
  - `components/`: children used only by this parent, re-exported from `components/index.ts`.
  - `workflow/`: non-visual logic for this component (hooks, stores, pure functions, mappings), re-exported from `workflow/index.ts`.
  - `assets/`: static files the component imports (images). Only the owning component imports them; others use what its `index.tsx` re-exports.
  - `__tests__/`: tests for the files in the folder that holds it, e.g. `workflow/__tests__/rows.test.ts`.
- **Nesting:** at most 3 component levels. L1 is the folder directly under a category; `workflow`, `assets` and `__tests__` don't count. If a child needs a 4th level, lift it to `shared/` or `ui/`.
- **Shared children:** a child needed by two parents moves to their nearest common ancestor, or to `shared/` (domain) or `ui/` (generic). Non-visual logic used by more than one page belongs in `src/lib/`.
- **Barrels:** `components/index.ts` and `workflow/index.ts` use named re-exports only (`export { X } from "./x"`), with no `export *` and no `export default`.
  - Never import past another component's barrel, such as `…/components/child` or `…/workflow/file` (ESLint `no-restricted-imports`).
  - Keep `"use client"` on each client module, and don't make a server component depend on a barrel that pulls in server-incompatible code.
- **Imports:** inside a component folder, use relative imports to its own `./components`, `./workflow` and `./assets`. Everywhere else, use absolute `@/…` imports.
- **`src/lib/`** holds app-wide logic: db, sync, forms, network clock, `sw-navigation`. `workflow/` is component-local only.
- **Size:** ESLint `max-lines` is 300 (blank lines and comments skipped; tests and the i18n dictionaries are exempt). It is `warn` until the refactor ends, then `error`.
- **When moving code:** use `git mv` and update every import path. Also update moved paths in the CLAUDE.md files, `.claude/skills` and `.claude/agents`.

## Client rules
- **i18n:** every user-visible string goes in **both** `src/i18n/en.ts` and `src/i18n/uk.ts`. The `Messages` type enforces parity. Never hard-code English or show raw identifiers such as `card.upsert` or `evacPriority`.
- **Data writes** go through `src/lib/db/casualtyRepo.ts`. One Dexie transaction updates the aggregate, ticks the HLC and appends exactly one outbox entry. Never write `db.casualties` or `db.outbox` directly from UI code.
- **Sync** lives in `src/lib/sync/` (engine, pipeline, coalesce, rebase, conflicts). Any change there needs a regression test, and the `sync-reviewer` subagent should review it.
- **Times:** parse only complete `HHMM` / `HH:MM` tokens, and never anchor a time on a value the same keystroke sequence just wrote (P0-001). Use the helpers in `src/lib/forms/time.ts`.
  - Known gap: board rows and paper cells still anchor to the previous keystroke's value until the P0-001 follow-up (with P2-011/P2-024).
- **Tourniquets:** the type input never deletes a tourniquet. A tourniquet is removed only through the explicit Remove action with confirmation (P0-002). A blank type box restores the type captured on focus.
- **Never drop input silently:** an invalid or incomplete value stays visible. It is flagged with `aria-invalid` and listed under "Not saved" in the save banner.
- **Board** (store and row logic in `src/lib/board/`, imported from `@/lib/board`; UI in `components/pages/casualties/board/`): edits go through `BoardStore` slices. `lib/board` is shared by the board and the DD1380 sheet page, so it is reviewed like sync code (`sync-reviewer`). A save trims text, so keep the raw input on screen while the field is focused (P1-007).
- **Service worker** (`src/app/sw.ts`): API requests stay `NetworkOnly`. Never cache casualty data or responses that carry the `Authorization` header.
- **Errors:** never `void` a promise without `.catch`. Show failures in the save banner or the sync status.
- **Dev tools:** the panel is gated by `NEXT_PUBLIC_DEV_TOOLS`. It can wipe the local DB, so never enable it in a production build.
- **Scope:** these rules apply to new and changed code. In move-only refactor phases, don't fix existing violations in moved code (e.g. P3-015, P2-021); list them in the phase report instead.

## Tests
- Vitest uses the `node` environment with `fake-indexeddb/auto`. Tests are `*.test.ts(x)` files in a `__tests__/` folder next to the code they test, e.g. `lib/sync/__tests__/engine.test.ts`. A few legacy tests under `components/pages/casualties` are still colocated until their phase moves them.
- Commands: `pnpm --filter client test`, `pnpm --filter client typecheck`, `pnpm --filter client lint`.
- `NEXT_DIST_DIR=.next-e2e pnpm --filter client build` builds without touching the dev `.next`.
- For UI time or text input, test keystroke by keystroke, not with a single `fill()`.
