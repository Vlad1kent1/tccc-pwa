---
name: verify
description: Run every typecheck, lint, format check and unit-test suite in the workspace and report a summary table. Use after a change and before committing. No Docker needed; makes no changes.
---

# Verify the workspace

Run these four commands from the repository root, **one at a time, in this order**. Continue after a failure, and record each exit code, duration and the key failure lines:

1. `pnpm typecheck`: builds `@tccc/shared`, then type-checks shared, client, server and e2e.
2. `pnpm lint`: client ESLint and server oxlint (`--no-bail`, so both run).
3. `pnpm format:check`: server Prettier.
4. `pnpm test`: Vitest in client, server and shared.

Do not fix anything, and do not run Docker-based suites (that is `/verify-full`).

## Report
A table:

| Check | Result | Time | Notes |
|---|---|---|---|

Under it, put the failing files and errors, at most about 10 lines per check. For the tests, show the counts per package (passed, failed, skipped).

Mark these known pre-existing failures as **expected**, not regressions:
- `pnpm lint`: exactly one error in `apps/client/src/components/pages/casualties/board/tactical-board/index.tsx` (`react-hooks/set-state-in-effect`, P2-022) until that finding is fixed.
- `pnpm format:check`: every hand-written server file, until the repo-wide Prettier commit lands on `main`.

Anything else that fails is a regression: say so plainly at the top of the report.
