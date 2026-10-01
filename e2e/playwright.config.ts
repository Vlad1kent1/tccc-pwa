import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientOrigin = "http://127.0.0.1:3100";
const apiOrigin = "http://127.0.0.1:4100";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./src/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results/playwright.json" }], ["./src/metrics-reporter.ts"]],
  use: {
    baseURL: clientOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
          ],
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter server start",
      cwd: root,
      url: `${apiOrigin}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          "postgresql://postgres:password@localhost:5433/tccc_medical_db",
        PORT: "4100",
        CORS_ORIGIN: clientOrigin,
        CHAOS_ENABLED: "true",
        CHAOS_LATENCY_MS: "0",
        CHAOS_FAILURE_RATE: "0",
        CHAOS_DROP_RATE: "0",
      },
    },
    {
      command: "pnpm --filter client build && pnpm --filter client exec next start -H 127.0.0.1 -p 3100",
      cwd: root,
      url: clientOrigin,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: apiOrigin,
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
