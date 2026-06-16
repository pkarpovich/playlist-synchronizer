# Rewrite /health into a passive sync-health facts endpoint

## Overview
The current `/health` is misleading: it returns a hardcoded `status: 'UP'` (only
reflects that the HTTP server is up), `lastSyncAt` is declared but never set
(always null), and `syncAll` swallows per-playlist failures (logs only) so a
broken sync looks identical to a healthy one. This is the false-green that let the
Yandex source outage go unnoticed.

Rewrite it as a **passive sync-health facts endpoint**: the app records the
outcome of each sync run and `/health` reports facts (last-run status, per-playlist
results, `lastSyncAt`, `ageSeconds`, `spotifyReady`) and **always returns HTTP 200**
while the process is alive. Freshness/health POLICY lives with the consumer
(gatus), not the app - the app reports `ageSeconds`, the consumer thresholds it.
Because `/health` is always 200, it doubles safely as a docker liveness check
(a Yandex outage will not 503 it into a restart-loop).

Scope of THIS plan: the app side only (run-outcome recording + the facts endpoint
+ tests). Consumer wiring (gatus conditions, docker `healthcheck:`) is a separate
follow-up after this lands.

## Context (from discovery + brainstorm)
- Files involved:
  - `src/entities/sync-statistics.entity.ts` -> replace `SyncStatistics` with
    run-result types (`PlaylistRunResult`, `LastRun`)
  - `src/services/sync.service.ts` -> record `lastRun`; `sync()` returns a
    `PlaylistRunResult`; `syncAll` builds `LastRun`; drop cumulative `_statistics`
  - `src/services/health.service.ts` (new) -> compute the facts snapshot
  - `src/controllers/health.controller.ts` -> always 200 + snapshot
  - `src/container.ts` -> register `HealthService` + an injectable `now` clock;
    inject `spotifyService` into health
  - `src/index.ts` -> remove any reference to the old statistics shape
  - `src/entities.ts` / `src/services.ts` barrels -> export new types/service
- Patterns: awilix DI (CLASSIC, by-name), ESM/TS, Node 24, `node:test` run via
  `tsx --test` (added in the Yandex work). Injectable dependencies are registered
  in `container.ts` and constructed directly in unit tests (see the injected
  `fetchFn` precedent in `YandexMusicService`).
- The cron (`croner`, `@hourly`, `startNow`) calls `syncService.syncAll(...)` from
  `index.ts`; the HTTP server already mounts `/health` via the api controller.

## Development Approach
- **Testing approach: regular** (code, then tests in the same task). The project
  has a `node:test` harness; every task that adds/changes logic ships unit tests.
- Inject a `now` provider (`() => number`, epoch ms; default `() => Date.now()`) so
  `ageSeconds` is deterministic in tests - mirrors the injected `fetch` pattern.
- Keep changes surgical; preserve the source-only Yandex behavior and the existing
  sync logic (only the recording/reporting changes).
- Complete each task fully; all tests pass before the next.

## Testing Strategy
- **Unit tests** (`node:test` + `node:assert`, `*.test.ts`, `tsx --test`): cover the
  run-status helper, `SyncService` run recording (ok / failed / empty-source /
  partial), and `HealthService` snapshot mapping (with a fixed `now`, plus the
  no-run state).
- No e2e tests in this project.

## Progress Tracking
- Mark `[x]` when done; `➕` for discovered tasks; `⚠️` for blockers. Keep in sync.

## What Goes Where
- **Implementation Steps**: types, service/controller code, DI wiring, tests.
- **Post-Completion**: consumer wiring (gatus conditions, docker healthcheck) and
  live verification - deliberately deferred.

## Implementation Steps

### Task 1: Run-result types + computeRunStatus helper
- [ ] in `src/entities/` add `PlaylistRunResult` (`{ name, status:
      'ok'|'failed'|'empty-source', sourceTracks, matched, added, notFound, error? }`)
      and `LastRun` (`{ startedAt, finishedAt, durationMs, status:
      'ok'|'partial'|'failed', playlists: PlaylistRunResult[] }`); export via
      `src/entities.ts`
- [ ] remove the old `SyncStatistics` type
- [ ] add a pure `computeRunStatus(playlists: PlaylistRunResult[]): 'ok'|'partial'|'failed'`
      (all ok -> ok; some ok & some not -> partial; none ok -> failed)
- [ ] write tests for `computeRunStatus` (all ok, mixed, all failed, empty list)
- [ ] run tests - must pass before next task

### Task 2: SyncService records the last run
- [ ] change `sync()` to return a `PlaylistRunResult` (counts: sourceTracks,
      matched, added, notFound); return `status:'empty-source'` instead of the
      silent early return on an empty source; `status:'ok'` otherwise
- [ ] `syncAll`: capture startedAt/finishedAt/durationMs, collect each playlist's
      result (the per-playlist try/catch now records `status:'failed', error` rather
      than only logging), set `_lastRun: LastRun` via `computeRunStatus`
- [ ] add `get lastRun(): LastRun | null` (null = no run yet); remove the old
      `_statistics` / `resetStatistics` / `statistics` getter
- [ ] write tests: all-ok -> `status:'ok'`; a throwing playlist -> that result
      `failed` and overall `partial`/`failed`; empty source -> `'empty-source'`;
      no run yet -> `lastRun === null`
- [ ] run tests - must pass before next task

### Task 3: HealthService (facts snapshot)
- [ ] add `src/services/health.service.ts` with a `HealthService` that takes
      `syncService`, `spotifyService`, and an injectable `now: () => number`
- [ ] `snapshot()` returns `{ status: lastRun?.status ?? 'no-run', lastSyncAt:
      <ISO|null>, ageSeconds: <number|null>, spotifyReady: spotifyService.isReady,
      lastRun }` (ageSeconds computed from `now()` and finishedAt)
- [ ] register `HealthService` and a `now` provider (default `() => Date.now()`) in
      `src/container.ts`; export via `src/services.ts`
- [ ] write tests: mapping a `LastRun` with a fixed `now` (assert `ageSeconds`,
      `lastSyncAt`, `status`, `spotifyReady`); no-run -> `status:'no-run'`, nulls
- [ ] run tests - must pass before next task

### Task 4: HealthController returns facts, always 200
- [ ] update `src/controllers/health.controller.ts` to inject `HealthService` and
      respond `res.status(200).json(healthService.snapshot())`
- [ ] update `src/container.ts` wiring for the controller
- [ ] write a test for the handler (returns 200 and the snapshot shape)
- [ ] run tests - must pass before next task

### Task 5: Cleanup + integration
- [ ] remove all references to the removed `SyncStatistics`/`statistics` (e.g. in
      `src/index.ts`); ensure `syncAll` is the single entry the cron calls
- [ ] `pnpm build`, `pnpm check-types`, `pnpm lint`, `pnpm test` - all green
- [ ] grep confirms no leftover `SyncStatistics` / `resetStatistics` references

### Task 6: Verify acceptance criteria
- [ ] `/health` always returns 200 with `{status, lastSyncAt, ageSeconds,
      spotifyReady, lastRun:{...,playlists:[...]}}`
- [ ] a failed or empty-source playlist is reflected in `lastRun` (not swallowed)
- [ ] `lastSyncAt`/`ageSeconds` populate after a run; `no-run` state before any run
- [ ] full unit suite + lint + build green

## Technical Details
- `now` injection: `() => number` epoch ms; default `() => Date.now()`; tests pass a
  fixed value so `ageSeconds` is deterministic.
- `lastSyncAt` exposed as an ISO string; `finishedAt` stored internally as epoch ms;
  `ageSeconds = Math.floor((now() - finishedAtMs) / 1000)`, `null` when no run.
- `status` reflects the last-run OUTCOME only (ok/partial/failed/no-run). Freshness
  is NOT judged by the app - the consumer thresholds `ageSeconds`.
- `notFound > 0` is normal and never marks a run unhealthy.
- HTTP is always 200 while the process serves (liveness); the body carries the
  health facts.

## Post-Completion
*Deferred to a separate follow-up - no checkboxes.*

- **gatus**: replace the `[BODY].statistics.totalTracksInOriginalPlaylists > 0`
  hack with body assertions on the new shape, e.g. `[BODY].ageSeconds < 7200`,
  `[BODY].status != failed` (and optionally per-playlist `sourceTracks > 0`). Lives
  in `home-environment/gatus/config.yml`.
- **docker healthcheck**: optionally add a `healthcheck:` to the prod compose
  hitting `/health` (safe now - always 200 = liveness, no restart-loop on a Yandex
  outage). Use `node -e` with global `fetch` (no curl in the slim image).
- Live verify on the deploy box: hit `/health`, confirm facts populate after a run.
