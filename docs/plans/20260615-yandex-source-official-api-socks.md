# Restore Yandex source via official API over a SOCKS5 (tailnet) proxy

## Overview
The Yandex source is broken: `yandex-short-api` calls the removed
`music.yandex.ru/handlers/playlist.jsx` web handler, which now returns 404. Yandex
decommissioned that endpoint; the replacement `api.music.yandex.net` is geo-blocked
outside RU/CIS.

Fix: replace `yandex-short-api` with a thin client on the official
`api.music.yandex.net`, fetching public playlists with no token, routed through a
SOCKS5 proxy that egresses from a RU box (the `vpn-exit-node` appliance, reached
over Tailscale). The app host (lasso) reaches the proxy via host-level Tailscale,
so only the Yandex client uses the proxy; Spotify stays direct.

Validated live: `GET api.music.yandex.net/users/flomaster-mc/playlists/1054`
through the RU SOCKS returns 200 with the full track list (141 tracks, titles +
artists) and no token.

Scope: Yandex stays source-only (no write). No token. youtube-music is dropped.
Yandex client gets unit tests (the project currently has none).

## Context (from discovery + brainstorm)
- Files involved:
  - `src/services/music-providers/yandex-music.service.ts` (rewrite internals)
  - `src/config/config.ts` (add `yandexMusic.{baseUrl,proxyUrl}`)
  - `src/container.ts` (inject `fetchFn` + config into the service)
  - `src/services/sync.service.ts` and `src/index.ts` (error handling / skip)
  - `package.json` (drop `yandex-short-api`; add `fetch-socks`; fix `test` script;
    bump Node types)
  - `src/@types/yandex-short-api/index.d.ts` (delete)
  - `docker-compose.yml` (collapse to the single traefik variant; pass env)
  - `mise.toml` (node 22 -> 24.16; remove the stale `.nvmrc`),
    `Dockerfile` (`NODE_VERSION` 22.13 -> 24.16),
    `.github/workflows/release.yml` (node-version 22 -> 24)
- Stack: Node (bump to 24.16), TS ESM, awilix DI (CLASSIC), express, croner, lowdb,
  signale, spotify-web-api-node, yup. Build via `tsc`; dev/run via `tsx`.
- Decisions locked in brainstorm: native `fetch` + `fetch-socks` (`socksDispatcher`),
  no axios; proxy/base URL from env (no RU/IP in code); test runner = built-in
  `node:test` run via `tsx`.
- Proxy node (set only in prod `.env`, not committed): `socks5h://100.121.175.96:1080`.

## Development Approach
- **Testing required for the Yandex client** (user request). Project had no tests;
  this introduces the harness (built-in `node:test`, zero new test deps, run via the
  existing `tsx`).
- Separate pure logic (URL building, response mapping) from I/O (fetch) so it is
  unit-testable; make `fetch` injectable via awilix so error paths are testable with
  a stub (no network).
- Complete each task fully; all tests pass before the next task.
- Surgical changes; keep the source-only Yandex behavior and the existing
  `BaseMusicService` shape.

## Testing Strategy
- **Unit tests** (`node:test` + `node:assert`, files `*.test.ts`, run with
  `tsx --test`): cover the Yandex client mapping, URL building, status/error
  handling, and the sync skip-on-failure behavior.
- No e2e/UI tests in this project. Live functional verification is manual and lives
  in Post-Completion (needs the RU proxy reachable over tailnet).

## Progress Tracking
- Mark items `[x]` when done; add discovered tasks; flag blockers. Keep in sync.

## What Goes Where
- **Implementation Steps**: code, tests, config, docs the agent can complete and
  verify locally (build, check-types, lint, unit tests, `docker compose config`).
- **Post-Completion**: host Tailscale setup, prod `.env` proxy value, image
  rebuild/publish, live sync verification.

## Implementation Steps

### Task 1: Test harness + Node 24.16 bump
- [x] set Node to `24.16` via mise in `mise.toml` (`node = "24.16"`) and remove the
      stale `.nvmrc`; `Dockerfile` `ARG NODE_VERSION=24.16`;
      `.github/workflows/release.yml` `node-version: 24`
- [x] devDeps: `@tsconfig/node22` -> `@tsconfig/node24`, `@types/node` -> `^24`;
      update `tsconfig.json` extends (also bumped `typescript` `^5.7.3` -> `^5.9.3`,
      required for the node24 base `esnext.*` libs to typecheck)
- [x] change `package.json` `test` script to `tsx --test 'src/**/*.test.ts'`
- [x] add a trivial `src/sanity.test.ts` asserting the runner works
- [x] run `pnpm install`, `pnpm build`, `pnpm check-types`, `pnpm test` - all pass

### Task 2: Config for Yandex base URL + proxy
- [x] extend `IConfig` and `Config` in `src/config/config.ts` with
      `yandexMusic: { baseUrl, proxyUrl }` from `YANDEX_API_BASE_URL`
      (default `https://api.music.yandex.net`) and `YANDEX_API_PROXY` (default empty)
- [x] keep the proxy/base URL out of code (env only)
- [x] write tests for the config mapping (default base URL, empty proxy) via a small
      pure reader/helper
- [x] run tests - must pass before next task

### Task 3: Pure Yandex helpers + fixture
- [ ] add `buildPlaylistUrl(baseUrl, owner, kind)` and
      `mapPlaylistTracks(json): Track[]` (map `result.tracks[].track` ->
      `{ name: title, artists: artists.map(a => a.name), source }`)
- [ ] add trimmed real fixture `src/services/music-providers/__fixtures__/yandex-playlist.json`
      (2-3 tracks, incl. a multi-artist track)
- [ ] write tests: mapping from fixture (names + multi-artist), URL building,
      empty `result.tracks` -> `[]`
- [ ] run tests - must pass before next task

### Task 4: Rewrite YandexMusicService on official API (fetch + fetch-socks)
- [ ] add dependency `fetch-socks`; remove `yandex-short-api` from `package.json`
      and delete `src/@types/yandex-short-api/`
- [ ] register an injectable `fetchFn` (default `globalThis.fetch`) in
      `src/container.ts`; inject `configService` + `fetchFn` into `YandexMusicService`
- [ ] implement `getPlaylistTracks`: build URL, build `socksDispatcher` from
      `proxyUrl` when set, `fetch` with that dispatcher, throw on non-2xx, map via
      `mapPlaylistTracks`; keep `isReady = true`; keep unimplemented write methods
- [ ] write tests with a stub `fetchFn`: 200 -> mapped tracks; non-2xx (404/451) ->
      throws; rejected fetch -> throws; empty playlist -> `[]`
- [ ] run tests - must pass before next task

### Task 5: Fail-loud source errors in the sync flow
- [ ] ensure a failed source fetch propagates (no silent `[]`); wrap per-playlist
      sync in `src/index.ts` `startSync` (and/or `SyncService.sync`) in try/catch so a
      failure logs a clear error and skips that playlist, the run continues, and it is
      not reported as `success Found 0 tracks`
- [ ] write tests for `SyncService`: when the source service throws, that playlist is
      skipped, other playlists still process, and no false success is recorded
- [ ] run tests - must pass before next task

### Task 6: docker-compose.yml + env wiring
- [ ] collapse `docker-compose.yml` to the single (latest) traefik-fronted service;
      remove the duplicate `services:`/`volumes:` block
- [ ] pass `YANDEX_API_PROXY: ${YANDEX_API_PROXY}` (and optional
      `YANDEX_API_BASE_URL`) in the service `environment`
- [ ] `docker compose config` parses cleanly
- [ ] update `.env.example` with `YANDEX_API_PROXY` (commented example, no real node)

### Task 7: Verify acceptance criteria
- [ ] no remaining references to `yandex-short-api` in the repo
- [ ] `pnpm build`, `pnpm check-types`, `pnpm lint`, `pnpm test` all green
- [ ] confirm the Yandex client and sync skip-on-failure are covered by tests

## Technical Details
- Client: `fetch(url, { dispatcher: socksDispatcher({ type: 5, host, port }) })` when
  `proxyUrl` set, else plain `fetch(url)`. `socks5h` semantics (remote DNS) come from
  routing the connection through the SOCKS proxy.
- Response: `data.result.tracks[].track.{title, artists[].name}` (confirmed on live
  data; exact nesting verified against the fixture).
- DI: tests construct `new YandexMusicService(logStub, configStub, fetchStub)`
  directly; no container needed.
- Spotify path is untouched and stays direct (not proxied).

## Post-Completion
*Manual / external - no checkboxes.*

- On lasso (app host): update Tailscale and re-authenticate so the host joins the
  tailnet; the container then reaches `100.121.175.96:1080` via host routing.
- Set `YANDEX_API_PROXY=socks5h://100.121.175.96:1080` in the prod `.env` (never
  commit it). Rebuild/publish the image (Node 24.16) and `docker compose up -d`.
- Verify a real run: source fetches the playlist (about 141 tracks) through the RU
  proxy and syncs to Spotify; `/health` shows stats; logs show no false
  `success Found 0 tracks` on failure.
- Ensure the RU node is up; if it is down the run should skip Yandex gracefully.
- Optional: delete the dropped `feature/youtube-music` branch.
