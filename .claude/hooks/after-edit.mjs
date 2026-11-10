// PostToolUse hook for Edit/Write. Kept fast (< 1 s):
//  - records the edited file for the Stop hook (typecheck + client ESLint run once per turn);
//  - server .ts files: `prettier --write`, but only if the file was already Prettier-clean at HEAD
//    (or is new). That keeps fix diffs free of whole-file reformatting until the repo-wide format
//    commit lands, after which every file qualifies. Then `oxlint` on that file.
// Client files are only recorded; ESLint costs ~7 s per run, so before-stop.mjs batches it.
import { existsSync } from "node:fs";
import path from "node:path";
import { projectDir, readInput, recordChange, repoRelative, runGit, runNode } from "./lib.mjs";

const serverDir = path.join(projectDir, "apps", "server");
const prettier = path.join(serverDir, "node_modules", "prettier", "bin", "prettier.cjs");
const oxlint = path.join(serverDir, "node_modules", "oxlint", "bin", "oxlint");

function cleanAtHead(rel, absolute) {
  const head = runGit(["show", `HEAD:${rel}`]);
  if (head.status !== 0) return true; // new file: nothing to preserve
  const formatted = runNode(prettier, ["--stdin-filepath", absolute], { cwd: serverDir, input: head.stdout, timeoutMs: 20_000 });
  return formatted.status === 0 && formatted.stdout === head.stdout;
}

const input = await readInput();
const filePath = input?.tool_input?.file_path;
const rel = repoRelative(filePath);
if (!rel) process.exit(0);

recordChange(input.session_id, rel);

const absolute = path.join(projectDir, rel);
const isServerTs = /^apps\/server\/(src|test)\/.+\.ts$/.test(rel) && !rel.startsWith("apps/server/src/generated/");
if (!isServerTs || !existsSync(absolute) || !existsSync(prettier)) process.exit(0);

const notes = [];
if (cleanAtHead(rel, absolute)) {
  const result = runNode(prettier, ["--write", absolute], { cwd: serverDir, timeoutMs: 20_000 });
  if (result.status !== 0) notes.push(`Prettier failed on ${rel}:\n${result.stderr || result.stdout}`);
}

if (existsSync(oxlint)) {
  const lint = runNode(oxlint, [path.relative(serverDir, absolute)], { cwd: serverDir, timeoutMs: 20_000 });
  if (lint.status !== 0) {
    process.stdout.write(
      JSON.stringify({
        decision: "block",
        reason: `oxlint reported problems in ${rel}. Fix them before continuing:\n${(lint.stdout + lint.stderr).trim().slice(0, 4000)}`,
      }),
    );
    process.exit(0);
  }
}

if (notes.length > 0) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: notes.join("\n\n").slice(0, 4000) }));
}
process.exit(0);
