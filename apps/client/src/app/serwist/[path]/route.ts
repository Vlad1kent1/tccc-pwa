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
  "/settings",
  "/~offline",
];

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: routeShells.map((url) => ({ url, revision })),
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    // The worker bundle is built by esbuild, not Next, so NEXT_PUBLIC_* is not inlined
    // for it. Without this, `process` is undefined in the worker: the API never matches
    // the NetworkOnly rule and the background push throws.
    esbuildOptions: {
      define: {
        "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(process.env.NEXT_PUBLIC_API_URL ?? ""),
      },
    },
  });
