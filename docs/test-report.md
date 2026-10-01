# Offline and unstable-network test report

This note is the source for thesis chapter 6. Sections outside the `aggregate` markers are the method and discussion. The script `pnpm --filter e2e report` replaces everything between each pair of markers from `e2e/results/` after `pnpm test:e2e`.

## Method

Each automated scenario runs in Playwright against a production client (`next start` on `127.0.0.1:3100`) and the NestJS API (`127.0.0.1:4100`). The client writes the casualty card to IndexedDB first and queues an outbox mutation. Synchronization runs only when the browser can reach `GET /api/health`.

Network conditions come from three fixtures:

- `offline()` sets the browser context offline, then restores it.
- `throttle(profile)` applies Chrome DevTools Protocol `Network.emulateNetworkConditions` for Fast 3G, Slow 3G, and Field 2G (Chromium only).
- `twoDevices()` opens two browser contexts so two installations edit one card.
- `serverCounts()` reads the pull feed and `GET /api/sync/conflicts`.

The server chaos middleware (`CHAOS_ENABLED`) adds latency, HTTP 503 responses, or a dropped socket after the database commit. Tests attach metrics with `test.info().attach("metrics")`. The Playwright reporter writes one JSON file per test under `e2e/results/`.

Scenarios that need a long soak, a service-worker update, storage-quota pressure, fifty-card timing, or volunteer timing are `test.skip` with instructions in `e2e/tests/manual.spec.ts`. WebKit in this Playwright build aborts a navigation started while the context is offline, so those scenarios run on Chromium. WebKit still runs the online drop and validation cases (T-04 and T-15).

## Environment

| Item | Value |
| --- | --- |
| Client | Next.js, `next start -H 127.0.0.1 -p 3100`, `NEXT_DIST_DIR=.next-e2e` |
| API | NestJS on port 4100, `CHAOS_ENABLED=true` |
| Database | PostgreSQL `localhost:5433`, database `tccc_medical_db` |
| Browsers | Playwright Chromium (Desktop Chrome) and WebKit (Desktop Safari) |
| Workers | 1 |
| Fast 3G | 562 ms RTT, 1.6 Mbps down, 750 kbps up |
| Slow 3G | 2000 ms RTT, 400 kbps down, 400 kbps up |
| Field 2G | 3000 ms RTT, 50 kbps down, 20 kbps up |

Lighthouse CI is configured in `lighthouserc.json` (PWA, accessibility, performance) against the same client origin. This aggregate step does not launch Lighthouse, so those scores stay empty until `lhci autorun`.

## Results

### Scenario outcomes

<!-- aggregate:scenarios -->

| Scenario | Browser | Status | Duration (ms) |
| --- | --- | --- | ---: |
| chaos latency still delivers one card | chromium | passed | 6788 |
| chaos latency still delivers one card | webkit | skipped | 66 |
| NFR-03 vitals input time | chromium | skipped | 8 |
| NFR-03 vitals input time | webkit | skipped | 5 |
| T-01 offline create survives reload and syncs once | chromium | passed | 26102 |
| T-01 offline create survives reload and syncs once | webkit | skipped | 124 |
| T-02 ten offline edits coalesce to the final value | chromium | passed | 21711 |
| T-02 ten offline edits coalesce to the final value | webkit | skipped | 76 |
| T-03 a dropped in-flight push is retried once | chromium | passed | 13027 |
| T-03 a dropped in-flight push is retried once | webkit | skipped | 55 |
| T-04 dropped responses still apply each mutation once | chromium | passed | 15534 |
| T-04 dropped responses still apply each mutation once | webkit | passed | 20683 |
| T-05 failures are retried and the card still syncs | chromium | passed | 7445 |
| T-05 failures are retried and the card still syncs | webkit | skipped | 23 |
| T-06 two devices keep edits to different fields | chromium | passed | 27965 |
| T-06 two devices keep edits to different fields | webkit | skipped | 21 |
| T-07 the later evac priority wins and a conflict is stored | chromium | passed | 36243 |
| T-07 the later evac priority wins and a conflict is stored | webkit | skipped | 17 |
| T-08 a later vitals edit beats an earlier delete | chromium | passed | 27094 |
| T-08 a later vitals edit beats an earlier delete | webkit | skipped | 26 |
| T-09 200 cards across a 72 hour offline period | chromium | skipped | 37 |
| T-09 200 cards across a 72 hour offline period | webkit | skipped | 18 |
| T-10 a card syncs on Fast 3G | chromium | passed | 6388 |
| T-10 a card syncs on Fast 3G | webkit | skipped | 39 |
| T-10 a card syncs on Field 2G | chromium | passed | 9521 |
| T-10 a card syncs on Field 2G | webkit | skipped | 74 |
| T-10 a card syncs on Slow 3G | chromium | passed | 11763 |
| T-10 a card syncs on Slow 3G | webkit | skipped | 91 |
| T-10 Slow 3G and Field 2G timing for 50 cards | chromium | skipped | 10 |
| T-10 Slow 3G and Field 2G timing for 50 cards | webkit | skipped | 2 |
| T-11 service worker update while offline | chromium | skipped | 2 |
| T-11 service worker update while offline | webkit | skipped | 4 |
| T-12 offline cold start renders the shell | chromium | passed | 10938 |
| T-12 offline cold start renders the shell | webkit | skipped | 45 |
| T-13 storage pressure | chromium | skipped | 3 |
| T-13 storage pressure | webkit | skipped | 4 |
| T-14 a clock one hour ahead still orders by HLC | chromium | passed | 42794 |
| T-14 a clock one hour ahead still orders by HLC | webkit | skipped | 30 |
| T-15 an invalid vitals payload is rejected without blocking a valid edit | chromium | passed | 8943 |
| T-15 an invalid vitals payload is rejected without blocking a valid edit | webkit | passed | 41012 |

<!-- /aggregate:scenarios -->

### Collected metrics

Counts and timings below come from the Chromium and WebKit runs that attached metrics. An empty cell means that scenario does not record the column. Payload bytes are the coalesced push body (T-02 sends one mutation after ten offline edits).

<!-- aggregate:metrics -->

| Scenario | Browser | Profile | Data loss | Duplicates | Sync (ms) | Payload (bytes) | Retries | First render (ms) | IndexedDB bytes/card |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| chaos latency still delivers one card | chromium | chaos-latency | 0 | 0 | 3583 | — | — | — | — |
| T-01 offline create survives reload and syncs once | chromium | — | 0 | 0 | — | — | — | — | 77848 |
| T-02 ten offline edits coalesce to the final value | chromium | — | — | — | — | 319 | — | — | — |
| T-04 dropped responses still apply each mutation once | chromium | — | 0 | 0 | — | — | — | — | — |
| T-04 dropped responses still apply each mutation once | webkit | — | 0 | 0 | — | — | — | — | — |
| T-05 failures are retried and the card still syncs | chromium | — | 0 | 0 | — | — | 2 | — | — |
| T-10 a card syncs on Fast 3G | chromium | Fast 3G | 0 | 0 | 584 | — | — | — | — |
| T-10 a card syncs on Field 2G | chromium | Field 2G | 0 | 0 | 1273 | — | — | — | — |
| T-10 a card syncs on Slow 3G | chromium | Slow 3G | 0 | 0 | 1646 | — | — | — | — |
| T-12 offline cold start renders the shell | chromium | — | — | — | — | — | — | 914 | — |

<!-- /aggregate:metrics -->

### Comparison with targets

Targets are NFR-01 to NFR-06 from `docs/requirements.md`. A single local run supplies one sample, so p50 and p95 of sync duration are that sample when only one measurement exists for a profile.

<!-- aggregate:nfr -->

| Requirement | Target | Measured | Result |
| --- | --- | --- | --- |
| NFR-01 | Card management for 72 hours offline (T-09, 200 cards) | Manual scenario, skipped in this run | Not measured |
| NFR-02 | 0 records lost | Maximum data loss 0, maximum duplicates 0 across recorded Chromium scenarios | Pass |
| NFR-03 | At most 3 taps or 15 seconds, 3 to 5 volunteers | Manual scenario, skipped in this run | Not measured |
| NFR-04 | 48 px targets, dark theme, contrast 4.5:1 | Lighthouse accessibility is configured and was not run | Not measured |
| NFR-05 | Under 5 seconds for 50 cards on Fast 3G | 1 card on Fast 3G in 584 ms. The 50-card case is manual | Not measured |
| NFR-06 | Offline shell in under 2 seconds | 914 ms (T-12) | Pass |

<!-- /aggregate:nfr -->

## Charts

### Sync time versus network profile

<!-- aggregate:sync-chart -->

| Profile | n | p50 (ms) | p95 (ms) | max (ms) |
| --- | ---: | ---: | ---: | ---: |
| chaos-latency | 1 | 3583 | 3583 | 3583 |
| Fast 3G | 1 | 584 | 584 | 584 |
| Field 2G | 1 | 1273 | 1273 | 1273 |
| Slow 3G | 1 | 1646 | 1646 | 1646 |

<!-- /aggregate:sync-chart -->

Figure placeholder: a bar chart of sync duration in milliseconds by network profile, using the table above and `e2e/results/metrics.csv` (`sync_ms`, `profile`).

### Retries versus failure rate

<!-- aggregate:retry-chart -->

| Scenario | Retries | Failure rate |
| --- | ---: | ---: |
| T-05 failures are retried and the card still syncs | 2 | 0.3 |

<!-- /aggregate:retry-chart -->

Figure placeholder: retry count against `CHAOS_FAILURE_RATE`. The automated suite records one rate, 0.3, in T-05. A sweep of rates would extend this series.

## Limitations

Background Sync exists only in Chromium. Safari and iOS rely on the foreground triggers (coming online, the tab becoming visible, the interval, and the manual Sync action). A closed iOS tab does not drain the outbox until the medic opens the app.

Headless Chromium denied persistent storage during these runs. IndexedDB can still be evicted under storage pressure. T-13, which fills the quota and checks the warning, is manual.

A device clock that is an hour ahead is ordered by the hybrid logical clock after the first contact with the server (T-14). A device that never syncs keeps ordering its own edits by that skewed wall clock.

WebKit aborts offline navigations in this Playwright version, so the offline scenarios are not evidence for Safari. The precached shell and the online sync paths are the WebKit coverage.

T-09 (200 cards across 72 hours), the 50-card Slow 3G and Field 2G timing, T-11 (service worker update while offline), T-13 (storage pressure), and the NFR-03 vitals timing with three to five volunteers are not part of the automated run.

## Conclusions

The automated scenarios that record data loss and duplicates finished at zero on the server after reconnect. Offline reload (T-01), a dropped in-flight push (T-03), and chaotic drops and failures (T-04, T-05) still applied each mutation once. Two devices converged on distinct fields without a conflict record (T-06) and on the later evacuation priority with a stored conflict (T-07). A later vitals edit beat an earlier delete (T-08). An invalid pain score was rejected without blocking a valid edit (T-15).

The offline cold start (T-12) is the measurement for NFR-06, and the one-card throttle runs are the measurement for sync duration. NFR-05's target is fifty cards on Fast 3G in under five seconds; that case is still the manual T-10. NFR-01, NFR-03, and NFR-04 are not measured here: the 72-hour soak, the volunteer input time, and the Lighthouse accessibility and PWA scores remain open.

The comparison table in Results is the pass or fail record for this run. Re-run the suite and `pnpm --filter e2e report` to replace it.
