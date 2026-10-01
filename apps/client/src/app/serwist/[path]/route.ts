import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

const revision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  crypto.randomUUID();

/** Static shells precached at install. Query-param routes share one shell. */
const routeShells = [
  "/",
  "/casualties/new",
  "/casualties/card",
  "/casualties/card/edit",
  "/casualties/card/vitals",
  "/settings",
  "/~offline",
];

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: routeShells.map((url) => ({ url, revision })),
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
