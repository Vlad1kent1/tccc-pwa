// Shared helpers for the project's Claude Code hooks. Node built-ins only, so the hooks run the
// same from Git Bash, PowerShell and CI without installing anything.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root: Claude Code sets CLAUDE_PROJECT_DIR for hooks; fall back to this file's location. */
export const projectDir = path.resolve(
  process.env.CLAUDE_PROJECT_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
);

export async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

/** `C:\x\y`, `c:/x/y` or `/c/x/y` → repo-relative POSIX path, or null when outside the repo. */
export function repoRelative(filePath) {
  if (!filePath) return null;
  let p = String(filePath).replace(/\\/g, "/");
  const msys = /^\/([a-zA-Z])\/(.*)$/.exec(p);
  if (msys) p = `${msys[1]}:/${msys[2]}`;
  const rel = path.relative(projectDir, path.resolve(p)).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

export function stripAnsi(text) {
  return String(text ?? "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Runs `node <script> ...args` without a shell; returns exit status and output. */
export function runNode(script, args, { cwd, input, timeoutMs = 300_000 } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: stripAnsi(result.stdout),
    stderr: stripAnsi(result.stderr || (result.error ? String(result.error) : "")),
  };
}

export function runGit(args) {
  const result = spawnSync("git", args, { cwd: projectDir, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ---- Per-session list of files edited this turn (written by after-edit, read by before-stop) ----

const stateDir = path.join(projectDir, ".claude", ".state");

function stateFile(sessionId) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(stateDir, `changed-${safe}.txt`);
}

export function recordChange(sessionId, rel) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(stateFile(sessionId), `${rel}\n`);
}

export function readChanges(sessionId) {
  const file = stateFile(sessionId);
  if (!existsSync(file)) return [];
  return [...new Set(readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean))];
}

export function clearChanges(sessionId) {
  rmSync(stateFile(sessionId), { force: true });
}

export function lastLines(text, count) {
  const lines = stripAnsi(text).split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.slice(-count).join("\n");
}
