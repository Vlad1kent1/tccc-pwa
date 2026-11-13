// Checks the component-folder rules that ESLint cannot see (apps/client/CLAUDE.md, "Component architecture").
// Run by `pnpm --filter client lint` after ESLint.
//
// Migration mode: a violation fails the check only under a MIGRATED path; anywhere else it is a warning,
// so lint stays green while the refactor moves code phase by phase. Phase 9 removes MIGRATED and every
// violation fails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Paths (relative to src, "/"-separated) that already follow the rules. */
const MIGRATED = [
  "lib",
  "components/pages/settings",
  "components/pages/home",
  "components/pages/offline",
  "components/shared/sync-badge",
  "components/layout",
];

const CATEGORIES = new Set(["layout", "pages", "shared", "ui"]);
/** Folders with a fixed meaning inside a component folder. */
const SPECIAL = new Set(["components", "workflow", "__tests__", "assets"]);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DEPTH = 3;
const TEST_FILE = /\.test\.tsx?$/;

const errors = [];
const warnings = [];

function report(rel, message) {
  const migrated = MIGRATED.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
  (migrated ? errors : warnings).push(`${rel}: ${message}`);
}

function rel(abs) {
  return path.relative(SRC, abs).split(path.sep).join("/");
}

function entries(dir) {
  return readdirSync(dir).map((name) => ({ name, abs: path.join(dir, name), dir: statSync(path.join(dir, name)).isDirectory() }));
}

function checkBarrel(dir) {
  const barrel = path.join(dir, "index.ts");
  let text;
  try {
    text = readFileSync(barrel, "utf8");
  } catch {
    report(rel(dir), "needs an index.ts barrel with named re-exports");
    return;
  }
  if (/\bexport\s*\*/.test(text)) report(rel(barrel), "uses `export *`; re-export by name");
  if (/\bexport\s+default\b/.test(text)) report(rel(barrel), "uses `export default`; barrels use named exports only");
}

/** A component folder at nesting level `depth` (1 = directly under a category). */
function checkComponent(dir, depth) {
  const name = path.basename(dir);
  if (!KEBAB.test(name)) report(rel(dir), "component folder names are kebab-case");
  if (depth > MAX_DEPTH) report(rel(dir), `nested ${depth} levels deep (max ${MAX_DEPTH}); lift it to shared/ or ui/`);
  const children = entries(dir);
  if (!children.some((child) => child.name === "index.tsx")) report(rel(dir), "a component folder needs index.tsx");
  for (const child of children) {
    if (!child.dir) continue;
    if (!SPECIAL.has(child.name)) {
      report(rel(child.abs), `unexpected folder in a component; use components/, workflow/, __tests__/ or assets/`);
      checkComponent(child.abs, depth + 1);
      continue;
    }
    if (child.name === "components") {
      checkBarrel(child.abs);
      for (const grandchild of entries(child.abs)) {
        if (grandchild.dir && grandchild.name !== "__tests__") checkComponent(grandchild.abs, depth + 1);
      }
    }
    if (child.name === "workflow") checkBarrel(child.abs);
  }
}

function checkTests(dir) {
  for (const entry of entries(dir)) {
    if (entry.dir) checkTests(entry.abs);
    else if (TEST_FILE.test(entry.name) && path.basename(dir) !== "__tests__") {
      report(rel(entry.abs), "tests live in a __tests__/ folder next to the code they test");
    }
  }
}

const componentsDir = path.join(SRC, "components");
for (const entry of entries(componentsDir)) {
  if (!entry.dir || !CATEGORIES.has(entry.name)) {
    report(rel(entry.abs), "src/components holds only layout/, pages/, shared/ and ui/");
    continue;
  }
  for (const component of entries(entry.abs)) {
    if (component.dir) checkComponent(component.abs, 1);
    else report(rel(component.abs), "only component folders belong directly under a category");
  }
}
checkTests(componentsDir);
checkTests(path.join(SRC, "lib"));

for (const line of warnings) console.warn(`warn   ${line}`);
for (const line of errors) console.error(`error  ${line}`);
console.log(`check-structure: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
