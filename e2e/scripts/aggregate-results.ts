import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface PlaywrightJson {
  suites?: Suite[];
}

interface Suite {
  title: string;
  suites?: Suite[];
  specs?: Spec[];
}

interface Spec {
  title: string;
  tests?: Array<{
    projectName?: string;
    results?: Array<{ status?: string; duration?: number }>;
  }>;
}

interface MetricFile {
  scenario?: string;
  project?: string;
  status?: string;
  durationMs?: number;
  dataLossCount?: number;
  duplicateCount?: number;
  syncDurationMs?: number;
  payloadBytes?: number;
  retryCount?: number;
  timeToFirstRenderMs?: number;
  indexedDbBytesPerCard?: number;
  networkProfile?: string;
}

interface ScenarioRow {
  title: string;
  project: string;
  status: string;
  durationMs: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.resolve(here, "../results");
const reportPath = path.resolve(here, "../../docs/test-report.md");

const report = JSON.parse(readFileSync(path.join(resultsDir, "playwright.json"), "utf8")) as PlaywrightJson;
const rows: ScenarioRow[] = [];

function walk(suite: Suite): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.[0];
      rows.push({
        title: spec.title,
        project: test.projectName ?? "",
        status: result?.status ?? "unknown",
        durationMs: result?.duration ?? 0,
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child);
}

for (const suite of report.suites ?? []) walk(suite);
rows.sort((a, b) => a.title.localeCompare(b.title) || a.project.localeCompare(b.project));

function table(headers: string[], body: string[][], numericFrom = headers.length): string {
  const divider = headers.map((_, index) => (index >= numericFrom ? "---:" : "---")).join(" | ");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${divider} |`,
    ...body.map((cells) => `| ${cells.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function cell(value: number | string | undefined | null): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))] ?? null;
}

const scenarioMarkdown = table(
  ["Scenario", "Browser", "Status", "Duration (ms)"],
  rows.map((row) => [row.title, row.project, row.status, String(row.durationMs)]),
  3,
);

const metricRows = readdirSync(resultsDir)
  .filter((name) => name.endsWith(".json") && name !== "playwright.json")
  .map((name) => JSON.parse(readFileSync(path.join(resultsDir, name), "utf8")) as MetricFile)
  .filter(
    (row) =>
      row.dataLossCount != null ||
      row.duplicateCount != null ||
      row.syncDurationMs != null ||
      row.payloadBytes != null ||
      row.retryCount != null ||
      row.timeToFirstRenderMs != null ||
      row.indexedDbBytesPerCard != null,
  )
  .sort((a, b) => (a.scenario ?? "").localeCompare(b.scenario ?? "") || (a.project ?? "").localeCompare(b.project ?? ""));

const metricsMarkdown = table(
  ["Scenario", "Browser", "Profile", "Data loss", "Duplicates", "Sync (ms)", "Payload (bytes)", "Retries", "First render (ms)", "IndexedDB bytes/card"],
  metricRows.map((row) => [
    row.scenario ?? "",
    cell(row.project),
    cell(row.networkProfile),
    cell(row.dataLossCount),
    cell(row.duplicateCount),
    cell(row.syncDurationMs),
    cell(row.payloadBytes),
    cell(row.retryCount),
    cell(row.timeToFirstRenderMs),
    cell(row.indexedDbBytesPerCard),
  ]),
  3,
);

const byProfile = new Map<string, number[]>();
for (const row of metricRows) {
  if (row.project !== "chromium" || row.syncDurationMs == null) continue;
  const profile = row.networkProfile ?? "unspecified";
  const samples = byProfile.get(profile) ?? [];
  samples.push(row.syncDurationMs);
  byProfile.set(profile, samples);
}
const syncChart = table(
  ["Profile", "n", "p50 (ms)", "p95 (ms)", "max (ms)"],
  [...byProfile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([profile, samples]) => [
      profile,
      String(samples.length),
      cell(percentile(samples, 50)),
      cell(percentile(samples, 95)),
      cell(Math.max(...samples)),
    ]),
  1,
);

const retryRows = metricRows.filter((row) => row.retryCount != null && row.project === "chromium");
const retryChart = table(
  ["Scenario", "Retries", "Failure rate"],
  retryRows.map((row) => [row.scenario ?? "", String(row.retryCount), row.scenario?.startsWith("T-05") ? "0.3" : "—"]),
  1,
);

function chromium(match: (row: MetricFile) => boolean): MetricFile | undefined {
  return metricRows.find((row) => row.project === "chromium" && match(row));
}

const lossValues = metricRows.filter((row) => row.project === "chromium" && row.dataLossCount != null).map((row) => row.dataLossCount ?? 0);
const duplicateValues = metricRows.filter((row) => row.project === "chromium" && row.duplicateCount != null).map((row) => row.duplicateCount ?? 0);
const maxLoss = lossValues.length === 0 ? null : Math.max(...lossValues);
const maxDuplicates = duplicateValues.length === 0 ? null : Math.max(...duplicateValues);
const fast3g = chromium((row) => row.networkProfile === "Fast 3G");
const firstRender = chromium((row) => row.timeToFirstRenderMs != null);

function verdict(pass: boolean | null): string {
  if (pass == null) return "Not measured";
  return pass ? "Pass" : "Fail";
}

const nfrMarkdown = table(
  ["Requirement", "Target", "Measured", "Result"],
  [
    ["NFR-01", "Card management for 72 hours offline (T-09, 200 cards)", "Manual scenario, skipped in this run", "Not measured"],
    [
      "NFR-02",
      "0 records lost",
      maxLoss == null ? "—" : `Maximum data loss ${maxLoss}, maximum duplicates ${maxDuplicates ?? "—"} across recorded Chromium scenarios`,
      verdict(maxLoss === 0 && maxDuplicates === 0),
    ],
    ["NFR-03", "At most 3 taps or 15 seconds, 3 to 5 volunteers", "Manual scenario, skipped in this run", "Not measured"],
    ["NFR-04", "48 px targets, dark theme, contrast 4.5:1", "Lighthouse accessibility is configured and was not run", "Not measured"],
    [
      "NFR-05",
      "Under 5 seconds for 50 cards on Fast 3G",
      fast3g?.syncDurationMs == null ? "—" : `1 card on Fast 3G in ${fast3g.syncDurationMs} ms. The 50-card case is manual`,
      "Not measured",
    ],
    [
      "NFR-06",
      "Offline shell in under 2 seconds",
      firstRender?.timeToFirstRenderMs == null ? "—" : `${firstRender.timeToFirstRenderMs} ms (T-12)`,
      verdict(firstRender?.timeToFirstRenderMs == null ? null : firstRender.timeToFirstRenderMs < 2000),
    ],
  ],
);

function fill(template: string, marker: string, content: string): string {
  const start = `<!-- aggregate:${marker} -->`;
  const end = `<!-- /aggregate:${marker} -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(template)) throw new Error(`docs/test-report.md is missing the ${marker} markers`);
  return template.replace(pattern, `${start}\n\n${content.trim()}\n\n${end}`);
}

let document = readFileSync(reportPath, "utf8");
document = fill(document, "scenarios", scenarioMarkdown);
document = fill(document, "metrics", metricsMarkdown);
document = fill(document, "nfr", nfrMarkdown);
document = fill(document, "sync-chart", syncChart);
document = fill(document, "retry-chart", retryChart);
writeFileSync(reportPath, document);

const csv = [
  "scenario,browser,status,duration_ms",
  ...rows.map((row) => `${JSON.stringify(row.title)},${row.project},${row.status},${row.durationMs}`),
].join("\n");
const metricCsv = [
  "scenario,browser,profile,data_loss,duplicates,sync_ms,payload_bytes,retries,first_render_ms,indexeddb_bytes_per_card",
  ...metricRows.map((row) =>
    [
      JSON.stringify(row.scenario ?? ""),
      row.project ?? "",
      row.networkProfile ?? "",
      row.dataLossCount ?? "",
      row.duplicateCount ?? "",
      row.syncDurationMs ?? "",
      row.payloadBytes ?? "",
      row.retryCount ?? "",
      row.timeToFirstRenderMs ?? "",
      row.indexedDbBytesPerCard ?? "",
    ].join(","),
  ),
].join("\n");

mkdirSync(resultsDir, { recursive: true });
writeFileSync(path.join(resultsDir, "summary.md"), `${scenarioMarkdown}\n\n${metricsMarkdown}\n`);
writeFileSync(path.join(resultsDir, "summary.csv"), `${csv}\n`);
writeFileSync(path.join(resultsDir, "metrics.csv"), `${metricCsv}\n`);
process.stdout.write(`Wrote ${reportPath}\n`);
