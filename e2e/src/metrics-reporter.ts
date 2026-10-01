import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function readAttachment(result: TestResult): Record<string, unknown> {
  const attachment = result.attachments.find((item) => item.name === "metrics");
  if (!attachment) return {};
  const raw = attachment.body
    ? attachment.body.toString("utf8")
    : attachment.path
      ? readFileSync(attachment.path, "utf8")
      : "";
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Writes one JSON file per test under `e2e/results` (PLAN.md 6.4). */
export default class MetricsReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "run";
    const dir = path.resolve("results");
    mkdirSync(dir, { recursive: true });
    const payload = {
      scenario: test.title,
      project,
      status: result.status,
      durationMs: result.duration,
      ...readAttachment(result),
    };
    writeFileSync(path.join(dir, `${slug(test.title)}-${project}.json`), JSON.stringify(payload, null, 2));
  }
}
