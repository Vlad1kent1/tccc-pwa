// PreToolUse guard for Bash and PowerShell commands. It backs up the deny rules in
// .claude/settings.json, which Bash pattern matching alone cannot enforce:
//   1. no database URL for a non-local host;
//   2. no DB-touching command (prisma migrate/db, db:* scripts, seed, server start, Playwright)
//      whose effective database host is not local (inline vars > environment > apps/server/.env);
//   3. no shell reads of .env files other than .env.example;
//   4. no destructive git or data commands, including `git -C …` and PowerShell forms.
// Reasons name the host only and never print credentials or URLs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectDir, readInput } from "./lib.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEV_URL = "postgresql://postgres:password@localhost:5433/tccc_medical_db";
const TEST_URL = "postgresql://postgres:password@localhost:5434/tccc_medical_db";

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  );
  process.exit(0);
}

function hostOf(url) {
  try {
    return new URL(String(url).trim().replace(/^postgres(ql)?:/i, "http:")).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

const isLocal = (host) => host != null && LOCAL_HOSTS.has(host);

/** VAR=value (bash prefix or export) and $env:VAR = value (PowerShell) assignments in the command. */
function inlineAssignments(command) {
  const vars = {};
  const bash = /(?:^|[\s;&|(])(?:export\s+|env\s+)?([A-Z_][A-Z0-9_]*)=("([^"]*)"|'([^']*)'|[^\s;&|)]+)/g;
  const pwsh = /\$env:([A-Z_][A-Z0-9_]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s;]+)/gi;
  for (const re of [bash, pwsh]) {
    for (const m of command.matchAll(re)) vars[m[1].toUpperCase()] = m[3] ?? m[4] ?? m[2];
  }
  return vars;
}

/** DATABASE_URL / DIRECT_URL / E2E_DATABASE_URL from apps/server/.env. Values stay in this process. */
function serverDotEnv() {
  const file = path.join(projectDir, "apps", "server", ".env");
  if (!existsSync(file)) return {};
  const vars = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(DATABASE_URL|DIRECT_URL|E2E_DATABASE_URL)\s*=\s*(.*)\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return vars;
}

/** First defined value of `name` in precedence order, with where it came from. */
function resolveVar(name, inline, dotEnv) {
  if (inline[name]) return { value: inline[name], source: "inline" };
  if (process.env[name]) return { value: process.env[name], source: "environment" };
  if (dotEnv[name]) return { value: dotEnv[name], source: "apps/server/.env" };
  return null;
}

function checkTarget(label, resolved) {
  if (!resolved) return;
  const host = hostOf(resolved.value);
  if (!isLocal(host)) {
    deny(
      `Blocked: ${label} would use a non-local database (host: ${host ?? "unparseable URL"}, from ${resolved.source}). ` +
        `Only localhost databases may be used from Claude Code; the deployed DB is never a target. ` +
        `Run it against Docker instead, e.g. prefix DATABASE_URL=${DEV_URL} (dev) or ${TEST_URL} (tests), and set DIRECT_URL the same way if it is defined.`,
    );
  }
}

/**
 * Commit and PR message text is never executed, so it is blanked before matching. Otherwise a
 * message that merely mentions ".env" or "git clean -f" would be blocked. The commands
 * themselves, and everything outside the message, are still checked.
 */
function withoutMessages(command) {
  let text = command;
  // Heredoc bodies fed to `git commit` / `gh pr|issue …` (e.g. `git commit -F - <<'EOF' … EOF`).
  text = text.replace(
    /((?:\bgit\s+commit|\bgh\s+(?:pr|issue)\s+\w+)[^\n]*<<-?\s*(['"]?)(\w+)\2[^\n]*\n)[\s\S]*?\n(\3)(?=\n|$)/g,
    (_match, head, _quote, _tag, end) => `${head}${end}`,
  );
  // Inline message arguments of those commands.
  if (/\bgit\s+commit\b|\bgh\s+(?:pr|issue)\b/.test(text)) {
    text = text.replace(
      /(\s(?:-m|--message|--body|--title|-b|-t)(?:=|\s+))("(?:[^"\\]|\\.)*"|'[^']*')/g,
      '$1""',
    );
  }
  return text;
}

function guard(command) {
  const text = withoutMessages(command.replace(/\r/g, ""));

  // 4. Destructive commands, matched within one command segment (no ; & | in between).
  const seg = "[^;&|\\n]*";
  const destructive = [
    [new RegExp(`\\bgit\\b${seg}\\bpush\\b${seg}(\\s--force(-with-lease)?\\b|\\s-[a-zA-Z]*f\\b|\\s\\+\\S)`), "force push"],
    [new RegExp(`\\bgit\\b${seg}\\breset\\b${seg}--hard\\b`), "git reset --hard"],
    [new RegExp(`\\bgit\\b${seg}\\bclean\\b${seg}(\\s-[a-zA-Z]*[fd]|\\s--force\\b)`), "git clean -f/-d"],
    [new RegExp(`\\bgit\\b${seg}\\bstash\\s+(drop|clear)\\b`), "git stash drop/clear"],
    [/\bdb:wipe\b|prisma\/wipe\.sql/, "pnpm db:wipe (truncates every table)"],
    [/\bdb:seed:mock\b|prisma\/seed\.ts/, "pnpm db:seed:mock (deletes and re-seeds cards)"],
    [/\bmigrate\s+reset\b/, "prisma migrate reset"],
    [/--filter\s+e2e\s+(run\s+)?report\b|aggregate-results\.ts/, "e2e report (overwrites tracked thesis results)"],
  ];
  for (const [re, what] of destructive) {
    if (re.test(text)) deny(`Blocked by project policy: ${what}. Ask the user to run it themselves if it is really needed.`);
  }

  // 3. Shell access to .env files other than .env.example.
  for (const m of text.matchAll(/(?:^|[\s"'=/\\:(<])\.env(\.[A-Za-z0-9_.-]+)?(?=$|[\s"'`;&|)>])/g)) {
    if (m[1] !== ".example") {
      deny("Blocked: .env files hold credentials and must not be read or written from Claude Code. Use .env.example for variable names.");
    }
  }

  // 1. Literal database URLs.
  for (const m of text.matchAll(/postgres(?:ql)?:\/\/[^\s'"`;|&)]+/gi)) {
    const host = hostOf(m[0]);
    if (!isLocal(host)) {
      deny(`Blocked: the command contains a database URL for a non-local host (${host ?? "unparseable"}). Only localhost databases may be used.`);
    }
  }

  // 2. Commands whose database comes from the environment or apps/server/.env.
  const inline = inlineAssignments(text);
  const dotEnv = serverDotEnv();
  const viaPrismaConfig = /\bprisma\s+(migrate|db)\b|\bdb:migrate\b/.test(text);
  const serverRuntime =
    /--filter\s+server\s+(run\s+)?(start|dev|start:dev|start:debug|start:prod)\b/.test(text) ||
    /(^|[\s;&|(])pnpm\s+(run\s+)?dev(\s|$)/.test(text) ||
    /\bnode\s+(apps\/server\/)?dist\/main\b/.test(text) ||
    /\bnest\s+start\b/.test(text);
  const playwright =
    /--filter\s+e2e\s+(run\s+)?test\b/.test(text) || /(^|[\s;&|(])pnpm\s+(run\s+)?test:e2e\b/.test(text) || /\bplaywright\s+test\b/.test(text);

  if (viaPrismaConfig) {
    // prisma.config.ts migrates DIRECT_URL || DATABASE_URL.
    checkTarget("this Prisma command", resolveVar("DIRECT_URL", inline, dotEnv) ?? resolveVar("DATABASE_URL", inline, dotEnv));
  }
  if (serverRuntime) {
    checkTarget("the API server", resolveVar("DATABASE_URL", inline, dotEnv));
  }
  if (playwright && !/--filter\s+server\b/.test(text)) {
    // e2e/src/database.ts migrates with DATABASE_URL=E2E_DATABASE_URL, but prisma.config.ts prefers DIRECT_URL.
    checkTarget("the Playwright migration (DIRECT_URL)", resolveVar("DIRECT_URL", inline, dotEnv));
    checkTarget("the Playwright test database (E2E_DATABASE_URL)", resolveVar("E2E_DATABASE_URL", inline, dotEnv));
  }
}

let command = "";
try {
  const input = await readInput();
  command = String(input?.tool_input?.command ?? "");
  if (command) guard(command);
} catch (error) {
  // Fail closed only where a mistake could reach a database or a secret.
  if (/postgres|prisma|db:|\.env/i.test(command)) {
    deny(`Blocked: the command guard hook failed (${error instanceof Error ? error.message : error}). Review .claude/hooks/guard-command.mjs.`);
  }
}
process.exit(0);
