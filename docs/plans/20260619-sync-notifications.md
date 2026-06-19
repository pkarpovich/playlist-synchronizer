# Sync notifications via tg-relay (md status card)

## Overview

Add best-effort notifications to `playlist-synchronizer`. After each sync run,
post a single status-card message to the existing tg-relay-bot (`POST /send`)
using its `parse_mode: "md"` mode, so the message is authored as clean Markdown
with zero MarkdownV2 escaping.

The notification fires once per `syncAll()` run. It shows an overall verdict
(did the sync succeed) plus a line per notable playlist: tracks added, tracks
not matched in Spotify, and failures. It is silent when a run had nothing
notable (no additions, no failures). It can never break or slow the sync
(best-effort, time-boxed, errors swallowed).

Problem it solves: the sync runs unattended on a cron; today nothing tells the
user when new tracks land, when source tracks cannot be found in Spotify, or
when a playlist fails (the same silent-failure class that hid the Yandex outage
for weeks). This closes that gap with a push notification through the relay the
user already runs.

Integration: a new `Notifier` is injected into `SyncService` and called at the
very end of `syncAll()`, after `_lastRun` is recorded. Transport reuses the
`fetchFn` already in the awilix container. Selected by config: if `NOTIFY_URL`
is set, a `RelayNotifier` is wired; otherwise a `NoopNotifier` (feature off, the
default in dev/CI).

**All notification copy is English** (verdict words, `not found in Spotify`,
`empty source`, `failed`). Only playlist names - which are user data - render in
their own language.

### Non-goals (v1)

- **No track names** in the message - counts only (added count, not-found
  count). Listing the actual tracks would require capturing `Track` objects
  through `sync()`; out of scope.
- **No retry / queue / backoff** - a single POST with a 5s timeout. A missed
  notification is acceptable; correctness of the sync is not at stake.
- **No extra channels** - ship `RelayNotifier` + `NoopNotifier` only. The
  `Notifier` interface leaves room for more later, but none are built now.
- **`notFound` never triggers a notification on its own** - `notFound` is
  recomputed identically every run (steady state), so notifying whenever
  `notFound > 0` would repeat the same message hourly. It is shown only as a
  suffix on a playlist line that is already in the digest because tracks were
  added. A playlist that is `ok` with 0 added (even if it has unmatched tracks)
  is not reported - that state lives in `/health`.
- **No config-validation framework** - read `NOTIFY_URL` / `NOTIFY_SECRET` as
  plain env, mirroring the existing `readYandexMusicConfig` pattern.
- **No change to the sync algorithm or `PlaylistRunResult` shape** - the
  notifier is a pure consumer of the existing `LastRun` (which already carries
  `added` and `notFound` per playlist).

### Rejected alternatives

- **One message per event** - rejected: noisier; several messages per run when
  multiple playlists change. Chose one digest per run.
- **Capturing added / not-found track names** - rejected for v1: needs threading
  `Track` objects out of `sync()`; counts are enough for a "what changed" ping.
- **Category-grouped issue line** (`failed 1: X; empty-source 1: Y`) - rejected:
  cryptic and hides the reason. Chose a per-playlist line with the real status
  and error text.
- **The word "Degraded"** for partial runs - rejected by the user. The verdict
  is about whether the sync succeeded: `Sync OK` / `Sync partial` / `Sync failed`.
- **`parse_mode: MarkdownV2` or `HTML`** - rejected: both need escaping. `md`
  (tg-relay's `sendRichMessage` path) is the entire reason that relay feature
  was built.
- **A generic event-bus / observer inside `SyncService`** - rejected: overkill
  for a single consumer; a direct `notifier.notify(lastRun)` call at the end of
  `syncAll()` is enough.

## Skills to invoke

No language-specific skill plugin applies (TypeScript/Node). Follow the repo's
established conventions when implementing every task:

- ESM with explicit `.js` import specifiers; barrels `src/services.ts`,
  `src/entities.ts`.
- awilix **CLASSIC** DI - constructor params are resolved by parameter name;
  register in `src/container.ts` and add to the `Container` interface.
- Tests: built-in `node:test` run via `tsx` (`npm test`), one `*.test.ts` per
  source file, colocated.
- Global style (user CLAUDE.md): no comments/docstrings, early-return, ASCII
  hyphens only - including inside the rendered message string.

## Context (from discovery)

- Files/components involved:
  - `src/services/sync.service.ts` - `syncAll()` builds `this._lastRun` (a
    `LastRun`); the notify call hooks in at the end. Constructor gains a
    `notifier` param.
  - `src/entities/sync-run.entity.ts` - existing `LastRun`, `PlaylistRunResult`
    (`name`, `status`, `sourceTracks`, `matched`, `added`, `notFound`, `error?`),
    `PlaylistRunStatus = 'ok' | 'failed' | 'empty-source'`, `RunStatus = 'ok' |
    'partial' | 'failed'`. Source of truth for the summary; not modified.
  - `src/config/config.ts` - `IConfig` + `Config`; add a `notify` section and a
    `readNotifyConfig(env)` helper mirroring `readYandexMusicConfig`.
  - `src/container.ts` - register `notifier`; add to `Container` interface;
    inject into `syncService`. The `fetchFn` value (`globalThis.fetch`) is
    already registered.
  - `src/services.ts` - barrel; export the new notifier module.
- Related patterns found:
  - `YandexMusicService` shows the injected-`fetchFn` pattern and a narrow
    response type (`Pick<Response,'ok'|'status'|'json'>`).
  - `HealthService` shows a pure, injectable-dependency service that reads
    `syncService.lastRun`.
  - `readYandexMusicConfig(env)` + `src/config/config.test.ts` show the
    env-read + test pattern to copy for `readNotifyConfig`.
- Dependencies identified: none new. Reuses `fetchFn`, `LogService`,
  `ConfigService`. `AbortSignal.timeout` is available on Node 24.

## Development Approach

- **Testing approach: Regular** (implement, then tests in the same task).
- Complete each task fully before the next; all tests green before moving on.
- Every task ships new/updated tests (success + error/edge cases).
- Keep changes surgical; do not touch the sync algorithm.
- Run `npm test` after each task.

## Testing Strategy

- **Unit tests** (`node:test` via `tsx`, colocated `*.test.ts`):
  - `summarizeRun` - pure, table-driven.
  - `renderDigest` - pure, asserts exact message strings for representative
    summaries (added-only, added-with-not-found, partial, full-fail).
  - `RelayNotifier` - fake `fetchFn` (records the request) + fake `LogService`;
    asserts request shape, the silent path, and error swallowing.
  - `NoopNotifier` - resolves, no side effects.
  - `readNotifyConfig` - env present / absent.
- No e2e harness in this project. Live smoke is manual (Post-Completion).

## Progress Tracking

- Mark `[x]` when done; `➕` for discovered tasks; `⚠️` for blockers. Keep synced.

## Solution Overview

Three small pure/near-pure units plus DI wiring:

1. `summarizeRun(lastRun)` reduces a `LastRun` to a `RunSummary` (overall verdict
   + one entry per notable playlist), or `null` when nothing is worth sending.
2. `renderDigest(summary)` turns a `RunSummary` into the md status-card string.
3. `Notifier` interface with `RelayNotifier` (summarize -> render -> POST to the
   relay, best-effort) and `NoopNotifier` (no-op). The container picks one based
   on `NOTIFY_URL`. `SyncService` calls `notifier.notify(this._lastRun)` at the
   end of `syncAll()`.

Key decisions:
- Pure `summarizeRun` / `renderDigest` keep all logic unit-testable without
  network or DI.
- `RelayNotifier.notify` is contractually no-throw, so `syncAll()` calls it
  without extra guarding.
- To avoid coupling the notifier to the Yandex module for a type, the notifier
  declares its own minimal fetch type (see Technical Details); the registered
  `fetchFn` (`globalThis.fetch`) satisfies it structurally.

## Technical Details

### Types / contracts (lock these; implementation is written during execution)

```ts
type PlaylistLine =
    | { name: string; kind: 'added'; added: number; notFound: number }
    | { name: string; kind: 'failed'; error?: string }
    | { name: string; kind: 'empty-source' };

type RunSummary = { verdict: RunStatus; lines: PlaylistLine[] };

function summarizeRun(lastRun: LastRun | null): RunSummary | null;
function renderDigest(summary: RunSummary): string;

type RelayFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

interface Notifier {
    notify(lastRun: LastRun | null): Promise<void>;
}
class RelayNotifier implements Notifier {} // (logService, configService, fetchFn)
class NoopNotifier implements Notifier {}
```

### `summarizeRun` rules

- `lastRun == null` -> `null`.
- Build `lines` by walking `lastRun.playlists`:
  - `status === 'failed'` -> `{ name, kind: 'failed', error }`.
  - `status === 'empty-source'` -> `{ name, kind: 'empty-source' }`.
  - `status === 'ok' && added > 0` -> `{ name, kind: 'added', added, notFound }`.
  - `status === 'ok' && added === 0` -> skipped (steady state; not reported,
    even if `notFound > 0`).
- if `lines` is empty -> `null` (silent run).
- otherwise `{ verdict: lastRun.status, lines }`.

### `renderDigest` format (status card, md, English copy)

- Title line: `🎵 Playlist Sync`
- Divider line on its own line. Use an ASCII divider (`---`); confirm during the
  live smoke whether Telegram rich-markdown renders it as a rule or literally,
  and fall back to a literal short ASCII line if needed. ASCII only - no em dash.
- Verdict line from `summary.verdict`:
  - `ok` -> `✅ Sync OK`
  - `partial` -> `⚠️ Sync partial`
  - `failed` -> `❌ Sync failed`
- Then one line per entry in `summary.lines`:
  - `added`: `✅ <name>: +<added>`, and when `notFound > 0` append
    ` (<notFound> not found in Spotify)`.
  - `failed`: `❌ <name>: <error>` (fallback `failed` when `error` is absent).
  - `empty-source`: `🕳 <name>: empty source`.

Example - clean success (3 added, 2 unmatched):

```
🎵 Playlist Sync
---
✅ Sync OK

✅ Риса за Творчество 2026: +3 (2 not found in Spotify)
```

Example - partial (added in 2 playlists, 1 failed, 1 empty source):

```
🎵 Playlist Sync
---
⚠️ Sync partial

✅ Риса за Творчество 2026: +3 (2 not found in Spotify)
✅ Chill Mix: +2
❌ Workout: services not ready
🕳 Discover Weekly: empty source
```

Example - full fail (nothing synced):

```
🎵 Playlist Sync
---
❌ Sync failed

🕳 Discover Weekly: empty source
```

### `RelayNotifier.notify` behavior

- `summary = summarizeRun(lastRun)`; if `null`, return without sending.
- Read `notify.url` / `notify.secret` from `ConfigService`.
- POST to the url: method `POST`, headers `Content-Type: application/json` and
  `X-Secret: <secret>`, body `{ message: renderDigest(summary), parse_mode: "md" }`,
  with `AbortSignal.timeout(5000)`.
- On a non-2xx response (`!resp.ok`): `logService.error("notify failed: HTTP <status>")`.
- On a thrown/timeout error: `logService.error("notify failed: <reason>")`.
- Never rethrow - the method always resolves.

### Config

- `IConfig` gains `notify: { url: string; secret: string }`.
- `readNotifyConfig(env)` returns `{ url: env.NOTIFY_URL || '', secret: env.NOTIFY_SECRET || '' }`.
- `Config.notify = readNotifyConfig(process.env)`.

### Container wiring

- Add `notifier: Notifier` to the `Container` interface.
- Register `notifier` with `asFunction` so selection can read the cradle:
  if `configService.get('notify.url')` is truthy -> `new RelayNotifier(logService, configService, fetchFn)`, else `new NoopNotifier()`; `.singleton()`.
- Add `notifier` to the `SyncService` constructor params (CLASSIC - resolved by
  name). No change to register order.

### Relay contract (source of truth, captured inline)

tg-relay-bot `POST /send`: JSON body `{ "message": <string>, "parse_mode": "md" }`,
header `X-Secret: <secret>`; `200 {"ok":true}` on success, `400` on an unknown
`parse_mode`. The `md` mode renders the message as a full Markdown string via
Telegram `sendRichMessage` (no escaping). Prod relay: `https://relay.pkarpovich.space/send`.

## What Goes Where

- **Implementation Steps** (`[ ]`): config, pure summary, pure render, the
  notifier classes, DI wiring, sync integration, tests, docs.
- **Post-Completion** (no checkboxes): live smoke against the prod relay, set
  `NOTIFY_URL`/`NOTIFY_SECRET` in the prod compose, redeploy.

## Implementation Steps

### Task 1: Add `notify` config

**Files:**
- Modify: `src/config/config.ts`
- Modify: `src/config/config.test.ts`

- [x] add `notify: { url: string; secret: string }` to the `IConfig` interface
- [x] add `readNotifyConfig(env: NodeJS.ProcessEnv): IConfig['notify']` returning
      `{ url: env.NOTIFY_URL || '', secret: env.NOTIFY_SECRET || '' }`
- [x] set `notify: readNotifyConfig(process.env)` on the `Config` object
- [x] write tests for `readNotifyConfig` (both env vars set; both absent -> empty strings)
- [x] run `npm test` - must pass before next task

### Task 2: Pure `summarizeRun`

**Files:**
- Create: `src/services/notifications/sync-summary.ts`
- Create: `src/services/notifications/sync-summary.test.ts`

- [x] add `PlaylistLine`, `RunSummary` types and `summarizeRun(lastRun: LastRun | null): RunSummary | null` per the rules in Technical Details
- [x] import `LastRun` / `PlaylistRunResult` / `RunStatus` from `../../entities.js`
- [x] write table-driven tests: `null` input; `ok` with added>0 (+notFound); `ok`
      with added 0 -> skipped; `ok` with added 0 but notFound>0 -> skipped/null;
      `failed` (with error); `empty-source`; mixed run -> correct `verdict` +
      `lines`; all `ok` zero-added -> `null`
- [x] run `npm test` - must pass before next task

### Task 3: Pure `renderDigest`

**Files:**
- Create: `src/services/notifications/render-digest.ts`
- Create: `src/services/notifications/render-digest.test.ts`

- [x] add `renderDigest(summary: RunSummary): string` producing the status card
      (title, ASCII divider, verdict line, then one line per `PlaylistLine` per
      the format in Technical Details)
- [x] write tests asserting exact strings for: added-only (no suffix when
      notFound 0); added-with-not-found suffix; partial (mixed kinds); full-fail;
      verdict word/emoji mapping (ok/partial/failed)
- [x] run `npm test` - must pass before next task

### Task 4: `Notifier` interface + `RelayNotifier` + `NoopNotifier`

**Files:**
- Create: `src/services/notifications/notifier.ts`
- Create: `src/services/notifications/notifier.test.ts`
- Modify: `src/services.ts`

- [ ] declare the `RelayFetch` minimal fetch type and the `Notifier` interface
- [ ] implement `NoopNotifier.notify` as a no-op resolving `Promise`
- [ ] implement `RelayNotifier` (constructor `logService`, `configService`,
      `fetchFn`): summarize -> if `null` return; else render and POST with the
      headers/body/timeout and error-swallowing in Technical Details; never rethrow
- [ ] export the module from `src/services.ts`
- [ ] write `RelayNotifier` tests with a fake `fetchFn` + fake `LogService`:
      asserts POST url, `X-Secret` header, body `{message, parse_mode:"md"}`;
      `null` summary -> `fetchFn` not called; non-`ok` response -> error logged,
      no throw; `fetchFn` rejects -> error logged, no throw
- [ ] write a `NoopNotifier` test (resolves, no calls)
- [ ] run `npm test` - must pass before next task

### Task 5: Wire the notifier into the container and `SyncService`

**Files:**
- Modify: `src/container.ts`
- Modify: `src/services/sync.service.ts`
- Modify: `src/services/sync.service.test.ts`

- [ ] add `notifier: Notifier` to the `Container` interface and register it via
      `asFunction` (RelayNotifier when `notify.url` is set, else NoopNotifier), `.singleton()`
- [ ] add `notifier` to the `SyncService` constructor params (CLASSIC, by name)
- [ ] call `await this.notifier.notify(this._lastRun)` at the end of `syncAll()`,
      after `_lastRun` is assigned
- [ ] update/extend `sync.service.test.ts`: inject a fake notifier, assert
      `notify` is called once after a run with the recorded `LastRun`; existing
      sync tests still pass
- [ ] run `npm test` - must pass before next task

### Task 6: Verify acceptance criteria

- [ ] verify all Overview requirements are implemented (one digest per run,
      verdict line, per-playlist lines, notFound suffix, silent on no-op,
      best-effort, `parse_mode:"md"`, config-gated, English copy)
- [ ] verify edge cases: empty `NOTIFY_URL` -> `NoopNotifier`; relay down ->
      sync still completes and records `LastRun`; `ok` run with only unmatched
      tracks -> silent
- [ ] run full suite: `npm test`
- [ ] run `npm run lint` and `npm run check-types` - fix all issues
- [ ] verify changed-package coverage is reasonable (pure functions + notifier paths covered)

### Task 7: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example` (if present; otherwise document in README)

- [ ] document `NOTIFY_URL` / `NOTIFY_SECRET` (notifications off when `NOTIFY_URL`
      is empty; sends a per-run md status card to a tg-relay `/send`)
- [ ] move this plan to `docs/plans/completed/`

## Post-Completion

*Items requiring manual intervention or external systems - no checkboxes.*

- **Live smoke**: with the service running and `NOTIFY_URL=https://relay.pkarpovich.space/send`
  + `NOTIFY_SECRET` set, trigger a sync and confirm the md status card renders in
  Telegram (title, divider, verdict line, `✅ <playlist>: +N`, and the not-found
  suffix / failure lines when applicable). Confirm a no-op run sends nothing.
  Confirm the divider renders as intended; adjust the divider char if Telegram
  shows it literally.
- **Prod config**: add `NOTIFY_URL` and `NOTIFY_SECRET` to the prod compose env
  on the host running `playlist-synchronizer`, then redeploy (`docker compose up -d`).
- The notifier depends on the relay's `md` mode, which is live in prod.
