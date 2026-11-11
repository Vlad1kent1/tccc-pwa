---
name: review-diff
description: Review the current diff (or the diff against a given base) against the CLAUDE.md rules and the domain safety rules, with findings sorted by severity. Read-only.
argument-hint: "[base-ref, default: uncommitted changes]"
---

# Review the diff

## 1. Collect the diff
- With no argument, review the uncommitted changes: `git diff` plus `git diff --cached`.
- With an argument, review the diff against that base: `git diff $0...HEAD`.
- List the changed files with `git diff --stat` (same range).
- If the diff is empty, say so and stop.

## 2. Load the rules
- Root `CLAUDE.md`: database rules, **domain safety rules**, fragile areas.
- Each touched package's `CLAUDE.md`: `apps/client`, `apps/server` or `packages/shared`.
- If the change relates to a finding and the local `CODE_REVIEW.md` exists (it is gitignored and optional), read its section there.

## 3. Review
- Read each changed hunk **in full-file context**, plus the callers it affects.
- Check correctness, edge cases, error handling, test coverage, and the conventions:
  - client: i18n en/uk parity, component architecture;
  - server: ESM `.js` imports, DTO `static schema`, `@Public()` use;
  - commits: Conventional Commits.
- Domain safety checks:
  - casualty data loss or silent overwrite;
  - wrong clinical or tourniquet times;
  - PII in logs, caches or error responses;
  - any change to sync, merge, outbox, rebase, HLC or time parsing without a regression test that would fail without the fix.
- If the diff touches `apps/client/src/lib/{sync,db}`, `apps/server/src/{sync,prisma}` or `packages/shared`, delegate that part to the **sync-reviewer** subagent and merge its findings.
- Verify each finding before reporting it. Prefer a few real issues over speculation.

## 4. Report (no edits)
List findings from most to least severe, on this scale:
- **P0 critical:** data loss or corruption, a security hole, a crash in a main flow, or wrong core results.
- **P1 high:** a bug users will hit, or missing error handling on an important path.
- **P2 medium:** edge-case bugs and maintainability problems that make bugs likely.
- **P3 low:** minor clean-code issues.

For each finding:
- `[P?] title`
- `file:line`
- Confirmed or Suspected
- the problem, in one or two sentences
- the concrete fix

End with a one-line verdict: **ready to commit**, **fix first**, or **needs discussion**.
