# Client (apps/client)

Next.js 16 App Router PWA with React 19, Turbopack, Serwist, Dexie and Tailwind 4.

**Next.js 16 differs from older versions.** Before using an App Router, caching or config API you are unsure about, read the bundled guide in `node_modules/next/dist/docs/` and follow its deprecation notices.

## Component architecture
- **`src/app` is for routing only:** `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`. Never put UI components or fragments there.
  - Known exception to move out: `sw-navigation.ts`.
- **Each component is a folder.** Name it in `kebab-case` and put the component in `index.tsx` inside it, e.g. `src/components/layout/theme-switcher/index.tsx`.
- **Categories under `src/components`:**
  - `layout/`: global layout pieces such as the app shell, banners and connectivity indicator. Add an `index.ts` barrel only if it helps.
  - `pages/<page>/`: sections specific to one page, grouped by page name, e.g. `pages/casualties/board/block-vitals/`.
  - `ui/`: reusable atomic elements, also in the `folder/index.tsx` form. Use a flat `button.tsx` only when explicitly requested.
- **Imports:** use absolute `@/…` imports (e.g. `@/components/layout/app-shell`), not relative paths.
- **When moving components:** create the kebab-case folder and `index.tsx`, and update every import path.

## Client rules
- **i18n:** every user-visible string goes in **both** `src/i18n/en.ts` and `src/i18n/uk.ts`. The `Messages` type enforces parity. Never hard-code English or show raw identifiers such as `card.upsert` or `evacPriority`.
- **Data writes** go through `src/lib/db/casualtyRepo.ts`. One Dexie transaction updates the aggregate, ticks the HLC and appends exactly one outbox entry. Never write `db.casualties` or `db.outbox` directly from UI code.
- **Sync** lives in `src/lib/sync/` (engine, pipeline, coalesce, rebase, conflicts). Any change there needs a regression test, and the `sync-reviewer` subagent should review it.
- **Times:** parse only complete `HHMM` / `HH:MM` tokens, and never anchor a time on a value the same keystroke sequence just wrote (P0-001). Use the helpers in `src/lib/forms/time.ts`.
- **Board** (`components/pages/casualties/board/`): edits go through `BoardStore` slices. A save trims text, so keep the raw input on screen while the field is focused (P1-007).
- **Service worker** (`src/app/sw.ts`): API requests stay `NetworkOnly`. Never cache casualty data or responses that carry the `Authorization` header.
- **Errors:** never `void` a promise without `.catch`. Show failures in the save banner or the sync status.
- **Dev tools:** the panel is gated by `NEXT_PUBLIC_DEV_TOOLS`. It can wipe the local DB, so never enable it in a production build.

## Tests
- Vitest uses the `node` environment with `fake-indexeddb/auto`. Tests are colocated as `*.test.ts(x)`, sometimes next to a component folder (e.g. `board/store.test.ts`).
- Commands: `pnpm --filter client test`, `pnpm --filter client typecheck`, `pnpm --filter client lint`.
- `NEXT_DIST_DIR=.next-e2e pnpm --filter client build` builds without touching the dev `.next`.
- For UI time or text input, test keystroke by keystroke, not with a single `fill()`.
