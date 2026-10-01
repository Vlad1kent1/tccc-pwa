import { describe, expect, it } from "vitest";
import {
  compareHlc,
  formatHlc,
  initialHlc,
  isNewerHlc,
  parseHlc,
  receiveHlc,
  tickHlc,
  type HlcState,
} from "./hlc.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("HLC", () => {
  it("round-trips through format and parse", () => {
    const state: HlcState = { wallTime: 1_790_000_000_123, counter: 42, nodeId: A };
    const text = formatHlc(state);
    expect(text).toBe(`1790000000123:0042:${A}`);
    expect(parseHlc(text)).toEqual(state);
  });

  it("rejects malformed timestamps", () => {
    expect(() => parseHlc("not-a-clock")).toThrow();
  });

  it("follows physical time when it moves forward", () => {
    const s = tickHlc(initialHlc(A), 1000);
    expect(s).toEqual({ wallTime: 1000, counter: 0, nodeId: A });
    expect(tickHlc(s, 2000)).toEqual({ wallTime: 2000, counter: 0, nodeId: A });
  });

  it("stays monotonic when physical time stalls or goes backwards", () => {
    let s = tickHlc(initialHlc(A), 5000);
    const stamps = [formatHlc(s)];
    for (const now of [5000, 4000, 3000, 5000]) {
      s = tickHlc(s, now);
      stamps.push(formatHlc(s));
    }
    const sorted = [...stamps].sort(compareHlc);
    expect(stamps).toEqual(sorted);
    expect(new Set(stamps).size).toBe(stamps.length);
    expect(s.wallTime).toBe(5000);
    expect(s.counter).toBe(4);
  });

  it("advances wall time by 1 ms on counter overflow", () => {
    const s = tickHlc({ wallTime: 1000, counter: 9999, nodeId: A }, 500);
    expect(s).toEqual({ wallTime: 1001, counter: 0, nodeId: A });
    expect(compareHlc(formatHlc(s), formatHlc({ wallTime: 1000, counter: 9999, nodeId: A }))).toBe(1);
  });

  it("orders a received remote event before subsequent local events", () => {
    const local = tickHlc(initialHlc(A), 1000);
    const remote = formatHlc({ wallTime: 60_000, counter: 3, nodeId: B });

    const merged = receiveHlc(local, remote, 1001);
    expect(merged).toEqual({ wallTime: 60_000, counter: 4, nodeId: A });

    const next = tickHlc(merged, 1002);
    expect(isNewerHlc(formatHlc(next), remote)).toBe(true);
  });

  it("keeps causality with a device clock one hour behind the server", () => {
    const hour = 3_600_000;
    const serverNow = 10 * hour;
    const deviceNow = serverNow - hour;

    const afterSync = receiveHlc(initialHlc(A), { wallTime: serverNow, counter: 0, nodeId: "server" }, deviceNow);
    const localEdit = tickHlc(afterSync, deviceNow + 1);

    expect(isNewerHlc(formatHlc(localEdit), formatHlc({ wallTime: serverNow, counter: 0, nodeId: B }))).toBe(true);
  });

  it("breaks ties between nodes deterministically by node id", () => {
    const a = formatHlc({ wallTime: 1000, counter: 0, nodeId: A });
    const b = formatHlc({ wallTime: 1000, counter: 0, nodeId: B });
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, a)).toBe(1);
  });

  it("treats a missing clock as the oldest", () => {
    expect(isNewerHlc(formatHlc({ wallTime: 1, counter: 0, nodeId: A }), undefined)).toBe(true);
  });
});
