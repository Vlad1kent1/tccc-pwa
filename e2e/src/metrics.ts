import { test } from "@playwright/test";

/** Numbers collected for PLAN.md section 6.4. The reporter writes them to `e2e/results`. */
export interface ScenarioMetrics {
  dataLossCount?: number;
  duplicateCount?: number;
  syncDurationMs?: number;
  payloadBytes?: number;
  retryCount?: number;
  timeToFirstRenderMs?: number;
  indexedDbBytesPerCard?: number;
  networkProfile?: string;
}

export async function attachMetrics(metrics: ScenarioMetrics): Promise<void> {
  await test.info().attach("metrics", {
    body: JSON.stringify(metrics),
    contentType: "application/json",
  });
}
