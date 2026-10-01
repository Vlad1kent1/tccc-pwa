import { test } from "../src/fixtures";

test("T-09 200 cards across a 72 hour offline period", async () => {
  test.skip(
    true,
    "Manual: seed 200 local cards, move the device clock forward 72 hours, scroll the casualty list, then reconnect. Confirm the UI stays responsive, every card reaches the server, and none are duplicated. Playwright's clock mock does not cover a multi-hour Background Sync wait.",
  );
});

test("T-10 Slow 3G and Field 2G timing for 50 cards", async () => {
  test.skip(
    true,
    "Manual: create 50 cards offline, enable Slow 3G (2000 ms RTT, 400 kbps) and then Field 2G (3000 ms RTT, 50 kbps down / 20 kbps up), and record sync duration against NFR-05 (under 5 s for 50 cards on Fast 3G). Automated T-10 covers one card on Fast 3G, Slow 3G, and Field 2G in Chromium.",
  );
});

test("T-11 service worker update while offline", async () => {
  test.skip(
    true,
    "Manual: install the app, go offline, publish a new next build, then reconnect. The old service worker should keep serving the shell with no data loss. After reconnect, the update banner appears and Reload activates the new worker.",
  );
});

test("T-13 storage pressure", async () => {
  test.skip(
    true,
    "Manual: in a fresh browser profile, fill IndexedDB until navigator.storage.estimate reports the quota is nearly full. Confirm the app warns, previously saved cards are still readable, and new writes fail visibly instead of deleting old cards.",
  );
});

test("NFR-03 vitals input time", async () => {
  test.skip(
    true,
    "Manual: with 3 to 5 volunteers, time a complete vitals set on /casualties/card/vitals. NFR-03 target is at most 3 taps or 15 seconds. Record the times in docs/test-report.md.",
  );
});
