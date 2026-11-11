---
name: mark-fixed
description: After a fix is merged into main, mark its finding as fixed in the local, gitignored CODE_REVIEW.md. Edits that file only; never stages or commits anything.
argument-hint: <finding-id> <commit-hash>
disable-model-invocation: true
allowed-tools: Bash(git merge-base *), Bash(git rev-parse *), Bash(git check-ignore *)
---

# Mark finding $0 as fixed by $1

`CODE_REVIEW.md` is a local working file at the repository root. It is gitignored, may be missing in a checkout, and must never be staged or committed. This skill makes no commit, so the current branch does not matter.

1. If the finding ID or the commit hash is missing, stop and ask for both: `/mark-fixed <ID> <hash>`.
2. If `CODE_REVIEW.md` does not exist at the repository root, stop. There is nothing to mark.
3. Check that the fix is merged: `git merge-base --is-ancestor $1 main` must succeed. If it fails, stop and say the commit is not on `main` yet.
4. In `CODE_REVIEW.md`, find the heading `### [$0]`. Normalize the ID to `P<n>-<nnn>` first.
   - If the heading is not there, stop.
   - If the finding already has a `- Fixed:` line, stop and show that line.
5. Insert one line directly under the heading: `- Fixed: <short hash of $1> (merged to main)`. Change nothing else.
6. Run `git check-ignore -q CODE_REVIEW.md` to confirm the file is still ignored. If it is not, warn the user. Never run `git add` or `git commit` for it.
7. Report the line you added.
