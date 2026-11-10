// Stop hook: before Claude finishes a turn that edited code, type-check the affected packages
// and run ESLint once over the client files edited this turn. Failures block the stop once, with
// the errors as the reason, so Claude fixes or reports them. `stop_hook_active` prevents loops.
// Limitation: only files changed through Edit/Write are tracked (not files changed via Bash).
import { existsSync } from "node:fs";
import path from "node:path";
import { clearChanges, lastLines, projectDir, readChanges, readInput, runNode } from "./lib.mjs";

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const CONFIG = /(^|\/)(package\.json|tsconfig(\.[\w-]+)?\.json)$/;

const PACKAGES = {
  shared: { dir: "packages/shared", prefix: "packages/shared/" },
  client: { dir: "apps/client", prefix: "apps/client/" },
  server: { dir: "apps/server", prefix: "apps/server/" },
  e2e: { dir: "e2e", prefix: "e2e/" },
};

function tsc(pkg, args) {
  const dir = path.join(projectDir, PACKAGES[pkg].dir);
  return runNode(path.join(dir, "node_modules", "typescript", "bin", "tsc"), args, { cwd: dir, timeoutMs: 300_000 });
}

const input = await readInput();
if (input?.stop_hook_active) process.exit(0);

const changed = readChanges(input.session_id).filter(
  (rel) => (CODE.test(rel) || CONFIG.test(rel)) && existsSync(path.join(projectDir, rel)),
);
if (changed.length === 0) {
  clearChanges(input.session_id);
  process.exit(0);
}

const touched = new Set(
  Object.entries(PACKAGES)
    .filter(([, pkg]) => changed.some((rel) => rel.startsWith(pkg.prefix)))
    .map(([name]) => name),
);
// Client, server and e2e compile against shared's dist, so a shared change re-checks all of them.
if (touched.has("shared")) ["client", "server", "e2e"].forEach((name) => touched.add(name));

const failures = [];
const passed = [];

if (touched.has("shared")) {
  const check = tsc("shared", ["--noEmit"]);
  if (check.status !== 0) failures.push(`typecheck shared:\n${lastLines(check.stdout + check.stderr, 25)}`);
  else {
    const build = tsc("shared", ["-p", "tsconfig.build.json"]);
    if (build.status !== 0) failures.push(`build shared:\n${lastLines(build.stdout + build.stderr, 25)}`);
    else passed.push("shared");
  }
}
for (const [name, args] of [
  ["client", ["--noEmit"]],
  ["server", ["--noEmit", "-p", "tsconfig.json"]],
  ["e2e", ["--noEmit"]],
]) {
  if (!touched.has(name)) continue;
  const result = tsc(name, args);
  if (result.status !== 0) failures.push(`typecheck ${name}:\n${lastLines(result.stdout + result.stderr, 25)}`);
  else passed.push(name);
}

const clientDir = path.join(projectDir, "apps", "client");
const lintable = changed
  .filter((rel) => rel.startsWith("apps/client/") && CODE.test(rel) && !/^apps\/client\/\.next/.test(rel))
  .map((rel) => path.relative(clientDir, path.join(projectDir, rel)));
if (lintable.length > 0) {
  const eslint = runNode(path.join(clientDir, "node_modules", "eslint", "bin", "eslint.js"), lintable, { cwd: clientDir });
  if (eslint.status !== 0) failures.push(`eslint (client, ${lintable.length} file(s)):\n${lastLines(eslint.stdout + eslint.stderr, 25)}`);
  else passed.push("eslint");
}

if (failures.length === 0) {
  clearChanges(input.session_id);
  process.exit(0);
}

const reason = [
  `Checks on the files edited this turn failed (passed: ${passed.join(", ") || "none"}).`,
  "Fix these errors, or tell the user exactly what still fails and why:",
  ...failures,
  "Known pre-existing failure: apps/client/src/components/pages/casualties/board/tactical-board/index.tsx react-hooks/set-state-in-effect (P2-022).",
].join("\n\n");
process.stdout.write(JSON.stringify({ decision: "block", reason: reason.slice(0, 8000) }));
process.exit(0);
