/** Chrome DevTools Protocol throughput is bytes per second. Plan figures are bits per second. */
function bitsPerSecond(bits: number): number {
  return Math.floor(bits / 8);
}

export const PROFILES = {
  "Fast 3G": {
    latency: 562,
    downloadThroughput: bitsPerSecond(1.6 * 1024 * 1024),
    uploadThroughput: bitsPerSecond(750 * 1024),
  },
  "Slow 3G": {
    latency: 2000,
    downloadThroughput: bitsPerSecond(400 * 1024),
    uploadThroughput: bitsPerSecond(400 * 1024),
  },
  "Field 2G": {
    latency: 3000,
    downloadThroughput: bitsPerSecond(50 * 1024),
    uploadThroughput: bitsPerSecond(20 * 1024),
  },
} as const;

export type NetworkProfile = keyof typeof PROFILES;
