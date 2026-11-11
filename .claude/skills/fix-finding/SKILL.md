---
name: fix-finding
description: Fix one finding from the local CODE_REVIEW.md test-first on its own branch. Write a failing regression test, make the minimal fix, verify, and commit. Never edits, stages or commits CODE_REVIEW.md.
argument-hint: <finding-id, e.g. P1-005>
disable-model-invocation: true
allowed-tools: Bash(git fetch *), Bash(git rev-parse *), Bash(git rev-list *), Bash(git branch *), Bash(git switch -c fix/*), Bash(git add *), Bash(git commit *)
---

# Fix finding $0

Follow these steps in order. **Stop and ask the user** whenever a step says so, or when something does not match what `CODE_REVIEW.md` describes.

`CODE_REVIEW.md` is a local, gitignored file at the repository root. It may be missing in a checkout, and it is never staged or committed.

## 1. Read the finding
- Normalize the ID: `$0` → uppercase `P<n>-<nnn>`, so `p1-5` becomes `P1-005`.
- If `CODE_REVIEW.md` does not exist, stop and ask the user to paste the finding (Problem, Location, Fix) or to restore the file. Otherwise, find the section `### [<ID>]` in it and read it all: Problem, Impact, Evidence, Fix and Location.
- If the section has a `- Fixed:` line, stop: it is already fixed.
- Read every file in **Location**, plus enough callers and tests to confirm the problem still exists at HEAD. If it doesn't, stop and report.

## 2. Branch gate
- `git rev-parse --abbrev-ref HEAD` must be `main`. Otherwise stop and ask.
- If `main` has an upstream (`git rev-parse --abbrev-ref main@{u}` succeeds), run `git fetch` and then `git rev-list --left-right --count main...main@{u}`. The **right-hand count must be 0** (not behind). Being ahead is fine. Otherwise stop and ask.
- Run `git status --short`. If the files you will touch have uncommitted changes, stop and ask.
- Create the branch with `git switch -c fix/<id-lowercase>-<short-kebab-slug>`, e.g. `fix/p1-005-idempotent-resolve`. The settings ask before any `git switch`, so expect a prompt.

## 3. Scope gate: stop and ask before any of these
- Changes to `packages/shared/src/schemas/**`, enum values, or the HLC format (see `packages/shared/CLAUDE.md`).
- Prisma schema or migration changes (`apps/server/prisma/**`).
- A Dexie schema version bump (`apps/client/src/lib/db/schema.ts`).
- Any change to the push, pull or resolve request and response shapes, or other sync protocol semantics.
- A fix that needs more than the finding's own scope, or touches several fragile areas (root `CLAUDE.md`).

Explain the options and their trade-offs, then wait.

## 4. Regression test first
- Write a test that reproduces the finding, next to the code using the package's conventions:
  - client and shared: `*.test.ts(x)`;
  - server unit: `src/**/*.spec.ts`;
  - server API: `test/*.e2e-spec.ts`;
  - Playwright: `e2e/tests/*.spec.ts`.
- For time and input bugs, drive keystroke sequences, not a single final value.
- Run only that test and **show that it fails for the reason the finding describes**. If you cannot make it fail, stop and report what you found.

## 5. Minimal fix
- Change only what the finding needs. Don't reformat unrelated code (the edit hook formats server files only when they were already clean). Don't refactor neighbours.
- Follow the root and package `CLAUDE.md` rules, especially the domain safety rules.

## 6. Verify
- Run the new test (it must pass now), then the affected packages' checks:
  `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint` (client/server), `pnpm --filter <pkg> test`.
- If the change is in `packages/shared`, also run `pnpm typecheck` (it rebuilds shared and checks every consumer).
- If server sync or prisma code changed and Docker is running, also run the server API e2e suite as in `/verify-full`. Ask before running Playwright.
- For changes in `apps/client/src/lib/{sync,db}`, `apps/server/src/{sync,prisma}`, `packages/shared` or time parsing, run the **sync-reviewer** subagent on the diff. Address every Confirmed finding it reports.

## 7. Commit (never push)
- Stage only the test and the fix: `git add <files>`.
- Write one Conventional Commit: `fix(<client|server|shared|e2e>): <what changed> (<ID>)`.
  - Body: the bug, the fix, and the test that covers it.
  - End it with the attribution trailer the session requires.
- **Never edit, stage or commit `CODE_REVIEW.md`.** It is local and gitignored. The finding is marked fixed with `/mark-fixed` after the merge.

## 8. Report
Give a short summary:
- the finding;
- the branch;
- the commit hash (`git rev-parse --short HEAD`);
- the test and its before/after result;
- the commands run with their results;
- any follow-ups.

End with the next step: *"After merging into `main`, run `/mark-fixed <ID> <hash>` on `main`."*
