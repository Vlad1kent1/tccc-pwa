import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

// Spike A (PLAN.md §2.2): use @serwist/turbopack, not @serwist/next.
// Next.js 16 builds with Turbopack by default, and the acceptance command is
// `next build` without `--webpack`. @serwist/turbopack compiles src/app/sw.ts
// with esbuild and serves it from /serwist/sw.js (Service-Worker-Allowed: /).
// Fallback if precaching or scope fails: @serwist/next and `next build --webpack`.

const nextConfig: NextConfig = {
  // E2E builds into a separate directory so `next build` does not clash with `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The dev indicator is a fixed layer. On iOS it sits above form fields and swallows taps.
  devIndicators: false,
  // Without this, Next answers the ngrok host with an HTML block page, and the
  // browser refuses to install /serwist/sw.js because its type is text/html.
  allowedDevOrigins: ["recent-strobe-saturday.ngrok-free.dev"],
  async headers() {
    return [
      {
        source: "/serwist/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
