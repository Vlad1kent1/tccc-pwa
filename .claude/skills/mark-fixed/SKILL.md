---
name: mark-fixed
description: After a fix branch is merged, mark its finding as fixed in CODE_REVIEW.md on main.
argument-hint: <finding-id> <commit-hash>
disable-model-invocation: true
allowed-tools: Bash(git rev-parse *), Bash(git merge-base *), Bash(git add CODE_REVIEW.md), Bash(git commit *)
---

# Mark finding $0 as fixed by $1

1. `git rev-parse --abbrev-ref HEAD` must be `main`. Otherwise stop and ask.
2. Check that the fix is merged: `git merge-base --is-ancestor $1 main` must succeed. If it fails, stop and say the commit is not on `main` yet.
3. In `CODE_REVIEW.md`, find the heading `### [$0]` (normalize the ID to `P<n>-<nnn>`).
   - If the finding already has a `- Fixed:` line, stop.
   - Otherwise insert one line directly under the heading: `- Fixed: <short hash of $1> (merged to main)`.
   - Change nothing else.
4. Run `git add CODE_REVIEW.md`, then commit `docs: mark $0 fixed` with the attribution trailer the session requires. Do not push.
5. Report the new commit hash.
