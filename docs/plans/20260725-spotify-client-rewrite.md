# Rewrite the sync: stateful mapping in SQLite, survivable auth, honest matching

## Overview

Production is crash-looping and the sync mechanism itself is unsound. Both problems were measured,
not inferred - a spike ran the real source playlist (Yandex `1045` / `flomaster-mc`, 264 tracks)
against the live Spotify API and against the real target playlist
(`7qqAU3xa2efU4T06IvcY2W`, 466 entries).

**1. The refresh token expired (2026-07-20).** The app's Spotify dashboard shows
`Refresh Token Lifetime: 180 days`. `src/index.ts:10` performs a top-level
`await spotifyService.initializeClient()` with no try/catch; `refreshAccess()` throws, the rejection
is unhandled, the process exits 1, and `restart: unless-stopped` restarts it forever.
`initializeClient` only prints the authorize URL when there is **no** token, so with a dead token the
recovery path is unreachable and the HTTP server dies with the process, taking `/spotify/callback`
with it. On expiry the token endpoint returns `400` `invalid_grant`; Spotify's guidance is to discard
the token and re-authorize, never to retry the refresh. This will now recur every 180 days, so
re-authorization must become a normal observable state rather than an outage.

**2. The sync has no memory, and that is the root defect.** Every run re-searches all 264 tracks and
rebuilds the target from whatever search returned *this time*. Consequences, all measured:

- **33 tracks churn URIs.** The matcher finds the song, but Spotify returns a different URI than the
  one in the playlist (single vs album, re-release). Each run would delete the playlist copy and add
  its own; the next run may pick another. Under a URI-based diff, 41 unique tracks would be removed,
  of which 33 are pure churn and only **8** genuinely left the source.
- **"Not found now" is indistinguishable from "removed from source."** That ambiguity - not the
  matcher - is what makes removals dangerous. No matcher tuning can resolve it.
- **~300 search calls per hour** for a playlist that changes rarely.
- **199 duplicate entries** accumulated (466 entries over 267 unique tracks, up to 4 copies of one
  track). `removeTracksFromPlaylist` sends every URI in one request while Spotify caps removal at 100
  objects, so the duplicate cleanup fails wholesale and duplicates pile up.

**3. The matcher rejected correct tracks.** Taking `items[0]` from search with no verification means a
track absent from Spotify silently matches whatever came first, and `notFound` under-reports. But the
first strict rewrite over-corrected: requiring a string match on artist names rejected 16 correct
tracks because Spotify stores those artists in Latin script (`Скриптонит`/`Skryptonite`,
`Хаски`/`Husky`, `ЛСП`/`LSP`, `Каспийский Груз`/`Kaspiyskiy Gruz`). Spotify's own search resolves
these aliases: `artist:"Скриптонит"` returns tracks by `Skryptonite`. Trusting the artist-scoped query
instead of re-checking strings raised the match rate from **92.8% to 98.9%** with zero false
positives across the 16.

The fix is therefore not a better matcher on top of the same mechanism. It is to give the sync
memory: resolve a source track to a Spotify track **once**, remember it, and drive removals from
recorded provenance instead of from this run's search results.

### Measured facts this plan is built on

| Fact | Value |
| --- | --- |
| Source playlist size | 264 tracks |
| Target playlist | 466 entries / 267 unique / 199 duplicates |
| Match rate, artist-string check | 92.8% (19 rejected) |
| Match rate, trusting artist-scoped query | 98.9% (3 rejected) |
| False positives among the 16 recovered | 0 |
| Removals under URI identity | 41 unique (33 of them churn) |
| Removals under provenance | 8 (all genuinely gone from source) |
| Search calls per run today | ~300 |
| Search calls per run in steady state after this change | 0 |

### Non-goals

- **Do not** send the re-authorization link to any notification channel, including the existing
  `RelayNotifier`/tg-relay. The link carries a single-use `state`; the external uptime check is the
  alerting path, and the link goes to the log only.
- **Do not** perform any production or host-level action. This plan changes repository code only.
- **Do not** migrate to PKCE. The classic authorization code flow with a client secret is documented
  as suitable for long-running applications and is what this app uses.
- **Do not** add a removal threshold, ratio guard, or "skip removals when suspicious" heuristic.
  Provenance makes removals exact; a guard on top would be guessing about a question that is no
  longer open.
- **Do not** remove target tracks that this app did not add. The system only ever removes what it
  recorded adding. Tracks added by hand survive syncing.
- **Do not** gate matching on track duration. Duration is recorded but not used as an acceptance
  criterion; no measurement supports a tolerance value yet.
- **Do not** touch `YandexMusicService`, `CronService`, `HttpService`, the notification logic, or the
  digest format.
- **Do not** change the external uptime-check configuration; it lives in another repository.

### Rejected alternatives

- **Keep the stateless recompute and only harden the matcher.** Measured: leaves 33 churning tracks
  and keeps "not found" indistinguishable from "removed". The removal threshold that this would
  require never fires at a 98.9% match rate, so it is protection in name only.
- **Identify tracks by Spotify URI.** Measured: 41 removals of which 33 are wrong. A URI is not a
  stable identity for a recording.
- **Identify tracks by ISRC end to end.** Spotify exposes `external_ids.isrc` and supports an `isrc:`
  search filter, but Yandex exposes no ISRC on the track or the album, through either the playlist
  endpoint or the per-track endpoint. The source side cannot supply it, so ISRC cannot be the primary
  key. It is still recorded on resolution as a secondary identity signal.
- **JSON file for the new state.** Three logical collections and a 264-row backfill that wants
  per-row commits turn a single JSON blob into a poorly reimplemented database. `node:sqlite` is
  built into Node 24 (verified working, no experimental warning) and costs zero dependencies.
- **The official `@spotify/web-api-ts-sdk`.** Documents browser PKCE, client credentials, and
  `withAccessToken`; no documented path for a server holding a refresh token on disk with precise
  `invalid_grant` interception and rotation persistence.
- **A shared HTTP wrapper for the token endpoint and the API.** The error policies differ
  fundamentally; one helper with flags is worse than two small ones.

### Unresolved hypothesis - must not be treated as fact

The February 2026 migration guide states that Development Mode apps lose `artist.followers`,
`artist.popularity`, `track.popularity`, `available_markets`, and `linked_from`, and that `/search`
is capped at `limit=10`. The app **is** in Development Mode (dashboard confirms), yet none of this
reproduced when probed with a client-credentials token: `followers` and `popularity` were present on
an artist object, `limit=50` returned `200`, and the deprecated `/playlists/{id}/tracks` still
returned `200`. The probe used an **app** token; the sync uses a **user** token, and the restrictions
may apply only to user-authorized requests. This cannot be settled until re-authorization happens.

Consequences for this plan, which must be followed exactly:

- Do **not** claim the current code has a live `TypeError`. It may or may not.
- Do declare response types that treat `followers`, `popularity`, `available_markets`, and
  `linked_from` as **optional or absent**, so the code is correct under both regimes.
- Do pin `limit=10` on search - valid under both regimes - rather than the 50 that the probe accepted.
- Do include a test proving the parsing path does not throw when those fields are missing.

## Skills to invoke

Do not go looking for a TypeScript/Node conventions skill and do not invoke documentation-retrieval
skills for the Spotify API. The binding rules for this plan are written out in Code-Quality Rules
below; the Spotify contracts in Technical Details are the authority. Read both before each task.

## Context (from discovery)

Files this work touches:

- `src/services/music-providers/spotify.service.ts` - rewritten
- `src/services/local-db.service.ts` - replaced by a SQLite-backed store
- `src/entities/auth-store.entity.ts` - superseded by the `auth` table
- `src/services/sync.service.ts` - provenance-driven diff
- `src/services/health.service.ts`, `src/controllers/health.controller.ts`
- `src/controllers/spotify.controller.ts`
- `src/container.ts`, `src/index.ts`
- `src/utils/cleanup.ts`
- `src/utils/retry.ts` - deleted
- `src/config/sync-config.ts`, `sync-config.json` - `excludedTrackIds` removed
- barrels `src/services.ts`, `src/entities.ts`, `src/controllers.ts`, `src/utils.ts`
- `package.json`, `pnpm-lock.yaml` - drop `spotify-web-api-node`, `@types/spotify-web-api-node`, `lowdb`

Patterns to follow:

- ESM with `.js` extensions in imports; TypeScript compiled by `tsc` into `dist/`
- awilix `CLASSIC` mode - constructor parameters resolve **by name**, registered in `src/container.ts`
- injected dependencies instead of globals: `fetchFn` and `now` are already registered
- pure helpers in their own file, tested without network - precedents
  `src/services/music-providers/yandex-music.helpers.ts`, `src/services/notifications/sync-summary.ts`
- tests next to the code as `*.test.ts`, `node:test` + `node:assert` (`strict`), run via `pnpm test`
- fixtures in `__fixtures__/` next to the service
- `SpotifyService` currently has no tests - the only service without them

## Development Approach

- **testing approach: regular** - code first, then tests in the same task, matching the plans in
  `docs/plans/completed/`
- complete each task fully before moving to the next
- **CRITICAL: every task MUST include new/updated tests** for its changes, covering success and
  error scenarios; tests are listed as separate checklist items
- **CRITICAL: Gate G (below) passes before starting the next task**, no exceptions
- **CRITICAL: update this plan file if scope changes during implementation**

## Code-Quality Rules (verify before marking each task complete)

**Gate G** is the exact, complete pass condition for every task:

```
pnpm check-types && pnpm lint && pnpm test && pnpm build
```

All four exit 0. Plus the comment check, whose empty output is the pass condition:

```
git diff -U0 $(git merge-base HEAD main) -- src | grep -E '^\+[[:space:]]*(//|/\*)' | grep -v 'eslint-disable'
```

Binding rules for all code in this plan (materialized here in full - there is no other rules file to
consult):

- **No comments and no docstrings.** Use clear names instead. Exception, in force because the repo
  needs it to lint: `// eslint-disable-next-line ...` and `// @ts-expect-error` are tooling
  directives, not comments; they are permitted and excluded from the comment check.
- **Early return.** Failure and edge cases first (`if (!x) return`), main logic flat.
- **Imports only at the top of the file**, never inside functions or methods.
- **ASCII hyphen `-` everywhere** - code, commits, documentation. No em or en dashes.
- Export new public entities through the barrels; register dependencies in `src/container.ts` with
  parameter names matching registration names; keep network and time behind injected dependencies.

Style guidance for the implementing agent, **not** review criteria: prefer the minimum code that
solves the task, avoid configurability nobody asked for, keep changes traceable to a task. A reviewer
**must not** report a finding based on a subjective judgement of file size or abstraction count. The
file layout in Technical Details is prescriptive - creating those files is required, not
over-abstraction.

## Testing Strategy

- **unit tests**: required in every task
- **e2e tests**: the project has none and none should be introduced
- all network stubbed through an injected fetch function; no test reaches outside
- all waiting goes through an injected `delayFn`; **no test sleeps in real time**
- SQLite tests use an in-memory database (`:memory:`), no filesystem fixtures

## Progress Tracking

- mark completed items `[x]` immediately
- new discovered tasks get a `➕` prefix; blockers get `⚠️`

## Solution Overview

**Storage.** One SQLite database via `node:sqlite`, replacing the lowdb JSON store. It holds three
collections: the auth record, the source-to-target track mapping, and the provenance of what this app
put into each target playlist.

**Auth.** `SpotifyAuthService` owns the refresh token, the access token with its `expiresAt`, the auth
state, authorize-URL generation, and code exchange. The rule "`invalid_grant` -> discard the token,
never retry" lives here alone. `SpotifyService` becomes a pure API client that asks for a token.

**Resolution.** A source track is searched for **once**. The result - Spotify URI, ISRC, duration - is
written to `track_map`. Subsequent runs read the mapping and issue no search. Tracks that resolve to
nothing get a negative row retried at most once per 24 hours.

**Diff.** Additions are mapped URIs missing from the target. Removals are provenance rows whose source
track is no longer in the source playlist - a recorded fact, not a search outcome. Consequence: the
system only ever removes what it recorded adding, so manual additions and pre-existing untracked
tracks are never touched.

**isReady** becomes derived from auth state rather than a flag that only ever turns on.

## Technical Details

### Spotify API contracts (transcribed 2026-07-25 - THIS SECTION IS THE ONLY AUTHORITY)

Do not fetch Spotify documentation and do not reconcile this section with prior knowledge; where this
section and recollection disagree, this section wins.

**Token endpoint.** `POST https://accounts.spotify.com/api/token`, header
`Authorization: Basic <base64(client_id:client_secret)>`, body `application/x-www-form-urlencoded`.

- refresh: `grant_type=refresh_token`, `refresh_token=<...>`
- code exchange: `grant_type=authorization_code`, `code=<...>`, `redirect_uri=<...>`

Success carries `access_token`, `token_type`, `expires_in` (seconds), and **optionally**
`refresh_token`. Errors are `400` with `{ "error": "...", "error_description": "..." }`; the codes
that matter are `invalid_grant`, `invalid_client`, `invalid_request`.

**Authorize URL.** `https://accounts.spotify.com/authorize` with `client_id`, `response_type=code`,
`redirect_uri`, `scope`, `state`. Scopes stay `playlist-read-private`, `playlist-modify-private`,
`playlist-modify-public`.

**Read playlist.** `GET /playlists/{playlist_id}/items` on `https://api.spotify.com/v1`. Query:
`limit` (max 50), `offset`. Response is a paging object with `items`, `next`, `total`, `limit`,
`offset`. **The entry field is `item`, not `track`** - each entry is
`{ added_at, added_by, is_local, item }`. Requires `playlist-read-private`.

**Add.** `POST /playlists/{playlist_id}/items`, body `{ "uris": [...] }`. **Max 100 per request.**
Returns `201` and `{ "snapshot_id": "..." }`.

**Remove.** `DELETE /playlists/{playlist_id}/items`, body `{ "items": [{ "uri": "..." }] }`.
**The array key is `items`, not `tracks`.** **Max 100 per request.** Returns `200` and
`{ "snapshot_id": "..." }`. Positions are not supported, so removing a URI removes **every**
occurrence of it in the playlist - this is what makes duplicate cleanup a delete-then-re-add.

**Search.** `GET /search`, query `q`, `type=track`, `limit`. **Pin `limit=10`** (see the unresolved
hypothesis above). Supported filters: `track:`, `artist:`, `album:`, `year:`, `genre:`, `isrc:`.
The response envelope is `{ "tracks": { "items": [ <track>, ... ], "next": ..., "total": ... } }` -
candidates are `body.tracks.items`, and `tracks` may be absent, which means zero candidates.

**Track object as this client declares it.** These are the only fields read or declared; declaring
nothing else is intended, not an omission:

```ts
type SpotifyTrack = {
    uri: string;
    name: string;
    type?: string;
    duration_ms?: number;
    artists: { name: string }[];
    external_ids?: { isrc?: string };
};
```

Skip a playlist entry when `item` is `null`, when `item.type` is present and not `'track'`, or when
`is_local` is `true`.

**Injected fetch types**, shared by the auth service and the API client:

```ts
type SpotifyFetchResponse = Pick<Response, 'ok' | 'status' | 'json'> & { headers: Pick<Headers, 'get'> };
type SpotifyFetchFn = (url: string, init?: RequestInit) => Promise<SpotifyFetchResponse>;
```

`src/container.ts` keeps its single `fetchFn: asValue(globalThis.fetch)` registration; the `Container`
interface widens the type to satisfy both this and the existing Yandex `FetchFn`.

### Database schema (node:sqlite)

One file at `<DB_PATH>/sync.db`. Tables created idempotently with `CREATE TABLE IF NOT EXISTS` at
startup; no migration framework.

- `auth` - `service TEXT PRIMARY KEY`, `refresh_token TEXT NOT NULL DEFAULT ''`,
  `revoked_at INTEGER`, `pending_state TEXT`
- `track_map` - `source_type TEXT`, `source_id TEXT`, `target_type TEXT`, `target_uri TEXT`,
  `isrc TEXT`, `duration_ms INTEGER`, `resolved_at INTEGER`, `last_tried_at INTEGER`,
  `attempts INTEGER NOT NULL DEFAULT 0`, primary key `(source_type, source_id, target_type)`.
  `target_uri IS NULL` means "searched and not found".
- `playlist_state` - `target_type TEXT`, `target_playlist_id TEXT`, `target_uri TEXT`,
  `source_type TEXT`, `source_id TEXT`, `added_at INTEGER`, primary key
  `(target_type, target_playlist_id, target_uri)`

**Migration from lowdb.** At startup, if the `auth` table has no row for `spotify` and
`<DB_PATH>/db.json` exists and parses with a non-empty `refreshToken`, insert that token into `auth`.
Leave `db.json` on disk untouched. This runs once and is a no-op afterwards.

### Auth state

```ts
type SpotifyAuthState = 'not-authorized' | 'authorized' | 'needs-reauthorization';
```

- startup, empty `refresh_token`, no `revoked_at` -> `not-authorized`
- startup, empty `refresh_token`, `revoked_at` set -> `needs-reauthorization`, no network call
- startup, `refresh_token` present -> one refresh attempt; success -> `authorized`;
  `invalid_grant` -> `needs-reauthorization`
- startup, refresh fails **transiently** after the full backoff budget -> state stays
  `not-authorized`, no `revoked_at` written, no authorize URL logged; the next `getAccessToken()`
  retries
- successful code exchange -> `authorized`, `revoked_at` and `pending_state` cleared
- `invalid_grant` at any point -> token discarded, `revoked_at` written, state
  `needs-reauthorization`, authorize URL logged

### Error classification (pure, no side effects - Task 3 owns discarding the token)

```ts
type TokenErrorClass = 'invalid-grant' | 'config-error' | 'transient';
type ApiErrorAction = 'refresh-retry' | 'no-retry' | 'retry-after' | 'backoff';
class SpotifyHttpError extends Error { readonly status: number; readonly code: string | null }
class SpotifyNotAuthorizedError extends Error {}
function classifyTokenResponse(status: number, body: unknown): TokenErrorClass;
function classifyApiStatus(status: number): ApiErrorAction;
function parseRetryAfter(header: string | null): number;
```

`classifyTokenResponse`: `400` with `error === 'invalid_grant'` -> `'invalid-grant'`; any other `400`
-> `'config-error'`; `429` and `5xx` -> `'transient'`. A thrown fetch error never reaches a
classifier - callers catch it and treat it as transient directly.

`classifyApiStatus`: `401` -> `'refresh-retry'`; `403` and `404` -> `'no-retry'`; `429` ->
`'retry-after'`; `5xx` -> `'backoff'`.

`parseRetryAfter`: integer seconds times 1000, clamped to a 60000 maximum; missing, non-numeric,
negative, or HTTP-date values return 1000.

### Backoff parameters

Transient retries: at most **3 attempts**, delays **500ms, 1000ms, 2000ms**, cap **8000ms**, no
jitter. `429` uses the parsed `Retry-After` instead of the backoff and is retried at most twice,
sharing the attempt budget. All waiting goes through an injected `delayFn: (ms: number) =>
Promise<void>`, registered in `src/container.ts` next to `now`; tests inject a recording stub and
assert the delay sequence.

### API request helper algorithm

`SpotifyService` has one private request path. For attempts 1..3:

1. Get a token via `spotifyAuthService.getAccessToken()`. If the auth state is not `authorized`, that
   throws `SpotifyNotAuthorizedError` - abort immediately, no retry.
2. Send the request with the bearer token.
3. On `2xx`, return the parsed JSON (or `null` for `204`).
4. On `401`: if a refresh was already used for this call, throw. Otherwise mark refresh used, ask the
   auth service to refresh, and retry **without consuming a backoff attempt**. If that refresh ends in
   `needs-reauthorization`, throw `SpotifyNotAuthorizedError`.
5. On `403` or `404`, throw `SpotifyHttpError` immediately.
6. On `429`, wait `parseRetryAfter(headers.get('retry-after'))` via `delayFn`, then retry, consuming
   an attempt.
7. On `5xx` or a thrown fetch error, wait the backoff delay for this attempt via `delayFn`, then
   retry.

After the budget is exhausted, throw `SpotifyHttpError`. The proactive expiry check lives inside
`getAccessToken()`, so it runs on every attempt.

### Access token refresh

`getAccessToken(): Promise<string>` throws `SpotifyNotAuthorizedError` when the state is not
`authorized`. `expiresAt` is receipt time plus `expires_in` seconds minus a 60-second margin.
Refreshes are **single-flight**: the service caches the in-flight promise and concurrent callers await
the same one, cleared in a `finally`. If the response carries a new `refresh_token`, **persist it
before** using the new access token.

### Track matcher

Pure functions, no network, no classes:

```ts
function normalizeTitle(value: string): { full: string; stripped: string };
function normalizeArtist(value: string): string;
function titleMatches(candidateName: string, sourceName: string): boolean;
function artistOverlaps(candidate: SpotifyTrack, sourceArtists: string[]): boolean;
```

Normalization order: lowercase -> NFD and strip combining marks -> replace `&` with ` and ` -> replace
everything matching `[^\p{L}\p{N}\s]` with a space -> collapse whitespace -> trim. The `stripped` form
additionally removes bracketed tails (`(...)`, `[...]`), everything from the **first** ` - ` onwards,
and a trailing bare `feat.`/`ft.` clause - and that removal runs **before** punctuation stripping.

`titleMatches` compares **same form to same form**: `full === full` OR `stripped === stripped`. Never
cross-form - cross comparison would make `Song - Part 2` match `Song`, the exact false positive this
rewrite exists to stop.

Clarified in Task 5, because same-form comparison alone does not stop that false positive: an
undecorated title strips to itself, so `stripped === stripped` still equates `Song - Part 2` with
`Song`. The stripped comparison therefore only applies when **both** titles actually lost a
decoration (`stripped !== full` on both sides). A decorated title never matches a bare one; only
`full === full` can accept that pair.

Resolution order in `SpotifyService.resolveTrack(source)`:

1. Search `track:"<title>" artist:"<first artist>"` with `limit=10`. Accept the first candidate whose
   title matches. **No artist string check** - the artist filter already constrained the query and
   Spotify resolves cross-script aliases itself, which is stronger evidence than our own comparison
   (measured: recovers 16 tracks, 0 false positives).
2. If nothing was accepted, search free text `"<title> <first artist>"` with `limit=10`. Accept the
   first candidate whose title matches **and** whose artists overlap the source artists - no filter
   constrained this query, so the artist must be verified here.
3. Otherwise return `null`.

Record `uri`, `external_ids.isrc`, and `duration_ms` of the accepted candidate. Duration is stored
only; it is not an acceptance criterion.

### Sync algorithm (provenance-driven)

Per source playlist, per target playlist:

1. Read the source playlist; build the set of current source track ids.
2. For each source id, look up `track_map`. Resolve via `resolveTrack` only when there is no row, or
   the row is negative (`target_uri IS NULL`) and `last_tried_at` is older than 24 hours. Upsert the
   result, incrementing `attempts` and setting `last_tried_at`.
3. `desired` = the non-null `target_uri` values for the current source ids.
4. Read the target playlist through `/items`.
5. **Adopt**: for every `desired` URI already present in the target with no `playlist_state` row,
   insert one. This backfills provenance for tracks earlier versions of this app added, and makes the
   first run remove nothing.
6. **Add**: `desired` URIs absent from the target, chunked by 100. Insert a `playlist_state` row for
   each.
7. **Remove**: `playlist_state` rows for this playlist whose `source_id` is not in the current source
   set. Remove those URIs chunked by 100 and delete the rows.
8. **Deduplicate**: for URIs appearing more than once in the target, remove the URI (which removes all
   occurrences) and add it back once. Both calls chunked by 100.

Tracks in the target with no `playlist_state` row are never removed. Manual additions survive, and so
do tracks that left the source before provenance existed.

### `/health` shape

`spotifyReady: boolean` is replaced by `spotify: { state: SpotifyAuthState }`, plus
`mapping: { resolved: number; unresolved: number }` read from `track_map`. The authorize link is
**not** placed in the body - the endpoint is public and the URL carries the single-use `state`. It
goes to the log only.

Assume, do not verify: the external uptime check reads only `[BODY].status` and `[BODY].ageSeconds`,
so dropping `spotifyReady` is safe. Do not look for that configuration in this repository.

## What Goes Where

- **Implementation Steps** (`[ ]`): everything inside this repository.
- **Post-Completion** (no checkboxes): deploy, the authorize click, production observation.

## Implementation Steps

### Task 1: SQLite store with schema and lowdb migration

**Files:**
- Create: `src/services/db.service.ts`
- Create: `src/services/db.service.test.ts`
- Modify: `src/container.ts`, `src/services.ts`, `package.json`, `pnpm-lock.yaml`
- Delete: `src/services/local-db.service.ts`, `src/entities/auth-store.entity.ts`

- [x] create `DbService` wrapping `node:sqlite` `DatabaseSync`, opening `<dbPath>/sync.db`, creating
      the parent folder when missing, and creating the three tables from Technical Details with
      `CREATE TABLE IF NOT EXISTS`
- [x] implement the lowdb migration exactly as specified: only when `auth` has no `spotify` row and
      `<dbPath>/db.json` parses with a non-empty `refreshToken`; leave `db.json` in place
- [x] expose typed accessors for the `auth` row (read, write refresh token, write `revoked_at`, write
      `pending_state`); no generic query surface
- [x] register `dbService` in `src/container.ts`, add it to the `Container` interface, delete the
      `authStore`/`LocalDbService` registration and remove `lowdb` from `package.json`, then run
      `pnpm install` so `pnpm-lock.yaml` no longer contains `lowdb`
- [x] write tests against `:memory:`: tables exist after construction, auth round-trips, migration
      imports a token exactly once and is a no-op on the second call, migration ignores an absent or
      malformed `db.json`
- [x] Gate G passes

### Task 2: Pure Spotify error classification

**Files:**
- Create: `src/services/music-providers/spotify-errors.ts`
- Create: `src/services/music-providers/spotify-errors.test.ts`
- Create: `src/services/music-providers/spotify-types.ts`
- Modify: `src/services.ts`

- [x] declare `SpotifyTrack`, `SpotifyFetchResponse`, and `SpotifyFetchFn` in `spotify-types.ts`
      exactly as written in Technical Details
- [x] implement `SpotifyHttpError`, `SpotifyNotAuthorizedError`, `classifyTokenResponse`,
      `classifyApiStatus`, and `parseRetryAfter` with the signatures and semantics from Technical
      Details; the classifiers are pure and perform no side effects
- [x] write tests covering every classification branch: `invalid_grant`, `invalid_client`, another
      `400`, `429`, `500`, and `401`/`403`/`404`/`429`/`5xx` on the API side
- [x] write tests for `parseRetryAfter`: `'2'` -> 2000, `'999'` -> 60000, `'abc'` -> 1000, `null` ->
      1000, `'-5'` -> 1000
- [x] Gate G passes

### Task 3: SpotifyAuthService - token lifecycle

**Files:**
- Create: `src/services/music-providers/spotify-auth.service.ts`
- Create: `src/services/music-providers/spotify-auth.service.test.ts`
- Modify: `src/container.ts`, `src/services.ts`

- [x] create `SpotifyAuthService` with dependencies `dbService`, `configService`, `logService`,
      `fetchFn`, `now`, `delayFn`; register `delayFn` in `src/container.ts` as
      `asValue((ms) => new Promise((r) => setTimeout(r, ms)))` and add it to the `Container` interface
- [x] implement `initialize(): Promise<void>` that **never throws**, plus `state` and `isReady`
      getters, following the state transition list in Technical Details
- [x] implement the token endpoint call and `getAccessToken()` with the proactive 60-second margin,
      single-flight refresh, and the backoff parameters from Technical Details
- [x] implement `invalid_grant` handling (discard, write `revoked_at`, log the authorize URL, no
      retries) and `config-error` handling (leave the token untouched)
- [x] persist a rotated `refresh_token` before using the new access token
- [x] write tests with a stubbed fetch and a recording `delayFn`: successful refresh; rotation
      persisted before use; `invalid_grant` discards and performs zero retries; `invalid_client`
      leaves the token; `429` and `5xx` retry with the exact delay sequence 500/1000/2000; startup
      with an empty token plus `revoked_at` yields `needs-reauthorization` with **zero** fetch calls;
      transient failure at startup leaves state `not-authorized` with no `revoked_at`
- [x] Gate G passes

### Task 4: SpotifyAuthService - authorize URL and code exchange

**Files:**
- Modify: `src/services/music-providers/spotify-auth.service.ts`
- Modify: `src/services/music-providers/spotify-auth.service.test.ts`

- [x] build the authorize URL per Technical Details with a random `state` from `node:crypto`, stored
      in `auth.pending_state`
- [x] implement `exchangeCode(code, state)`: compare against `pending_state`, reject without any
      network call on mismatch or absence; on success store the refresh token, clear `revoked_at` and
      `pending_state`, move to `authorized`
- [x] log the authorize URL when entering `not-authorized` or `needs-reauthorization`, formatted so it
      is visible in `docker logs`
- [x] write tests: two calls produce different `state` values; correct `state` exchanges and clears
      `revoked_at`; wrong or missing `state` is rejected with zero fetch calls; a reused `state` is
      rejected
- [x] Gate G passes

### Task 5: Pure track matcher

**Files:**
- Create: `src/services/music-providers/spotify-match.helpers.ts`
- Create: `src/services/music-providers/spotify-match.helpers.test.ts`

- [x] implement `normalizeTitle`, `normalizeArtist`, `titleMatches`, `artistOverlaps` exactly per
      Technical Details, including same-form-to-same-form comparison and the ordering of stripping
      before punctuation removal
- [x] write normalization tests: `(feat. X)`, bare `feat. X`, `[Bonus Track]`, `- Radio Edit`,
      `- Remastered 2011`, diacritics, `&` versus `and`, punctuation, extra whitespace
- [x] write tests that legitimate titles survive: `(Don't Fear) The Reaper` and `Song - Part 2` do not
      collapse to nothing and match themselves; `Song - Part 2` does **not** match `Song`
- [x] write Cyrillic tests drawn from the real source data: `Быть богатым feat. Платина` strips to
      `быть богатым`; `тРи пОлОсКи` normalizes case-insensitively
- [x] write `artistOverlaps` tests: exact normalized match accepts, `Скриптонит` versus `Skryptonite`
      does **not** overlap (documenting why step 1 of resolution must not use this check)
- [x] Gate G passes

### Task 6: SpotifyService - HTTP layer and playlist reads

**Files:**
- Modify: `src/services/music-providers/spotify.service.ts`
- Create: `src/services/music-providers/spotify.service.test.ts`
- Create: `src/services/music-providers/__fixtures__/spotify-playlist-items.json`
- Modify: `src/container.ts`
- ➕ Modify: `src/services/music-providers/spotify-auth.service.ts` - step 4 of the request algorithm
  needs the auth service to expose a forced refresh, so `refreshAccessToken()` was added: it drops the
  cached access token and goes back through the single-flight `getAccessToken()`

- [x] rewrite `SpotifyService` with dependencies `spotifyAuthService`, `logService`, `fetchFn`,
      `delayFn`; register `spotifyAuthService` in `src/container.ts` as part of this task so awilix can
      resolve it
- [x] **keep the tree compiling**: retain thin delegating members until Task 13 removes them -
      `initializeClient()` -> `spotifyAuthService.initialize()`, `authorizationCodeGrant(code)` ->
      `spotifyAuthService.exchangeCode(code, state)`, and `get isReady()` ->
      `spotifyAuthService.isReady` (which also satisfies `BaseMusicService` and keeps
      `SyncService.isAllServicesReady()` working)
- [x] ➕ the rewrite removed the `spotify-web-api-node` client that `searchTrackByName`,
      `addTracksToPlaylist`, and `removeTracksFromPlaylist` were built on, so those three
      `BaseMusicService` members carry `throw new Error('Method not implemented.')` bodies (the
      existing `YandexMusicService` precedent) until Tasks 7 and 8 implement them
- [x] implement the private request helper following the seven numbered steps in Technical Details
- [x] implement `getPlaylistTracks` over `GET /playlists/{id}/items` with `limit=50`, paging on
      `next`, reading `item` (not `track`), skipping entries where `item` is null, `item.type` is not
      `'track'`, or `is_local` is true; deduplicate in memory and never mutate the playlist on read
- [x] create the fixture by transcribing this shape, synthesizing values and fetching nothing: page 1
      has `items` with entries `{ added_at, is_local, item: { uri, name, type: 'track', artists: [{ name }], duration_ms, external_ids: { isrc } } }`,
      one entry with `item: null`, one with `item.type: 'episode'`, one with `is_local: true`, plus
      `next` pointing at page 2; page 2 has the same shape with `next: null`. No `popularity`,
      `followers`, or `available_markets` keys appear anywhere
- [x] write tests: paging collects both pages; the three skip cases are dropped rather than throwing;
      `401` triggers exactly one refresh and one retry; `403` triggers neither; `429` waits the parsed
      `Retry-After` via the recording `delayFn`; a read issues zero mutation requests
- [x] Gate G passes

### Task 7: SpotifyService - track resolution

**Files:**
- Modify: `src/services/music-providers/spotify.service.ts`
- Modify: `src/services/music-providers/spotify.service.test.ts`

- [x] implement `resolveTrack(source): Promise<{ uri, isrc, durationMs } | null>` following the three
      numbered resolution steps in Technical Details, always with `limit=10` and `type=track`
- [x] delete `searchArtistByName`, `createAdvancedSearchQuery`, `tryToFindMostRelevantArtist`, the
      in-process `cache` field, and every access to `popularity` and `followers` - already removed by
      the Task 6 rewrite, verified here by
      `grep -rn "searchArtistByName\|createAdvancedSearchQuery\|tryToFindMostRelevantArtist\|popularity\|followers" src` returning nothing
- [x] write tests: the field-filtered query is sent with `limit=10` and the exact filter syntax; a
      candidate whose artists do **not** overlap is still accepted from step 1 (the
      `Скриптонит`/`Skryptonite` case) but is **rejected** in step 2; an empty step-1 result triggers
      step 2; when nothing passes, the result is `null` and no add request follows
- [x] write a test that a search response whose artist objects lack `followers` and `popularity`
      resolves without throwing
- [x] Gate G passes

### Task 8: SpotifyService - add and remove with chunking

**Files:**
- Modify: `src/services/music-providers/spotify.service.ts`
- Modify: `src/services/music-providers/spotify.service.test.ts`

- [x] implement `addTracksToPlaylist` over `POST /playlists/{id}/items` with body `{ uris }`, chunked
      by **100**
- [x] implement `removeTracksFromPlaylist` over `DELETE /playlists/{id}/items` with body
      `{ items: [{ uri }] }` - key `items`, not `tracks` - chunked by **100**
- [x] write tests: 250 URIs to add produce exactly 3 requests sized 100/100/50; 250 to remove do the
      same; the removal body uses the `items` key; an empty list issues zero requests
- [x] Gate G passes

### Task 9: Track mapping service

**Files:**
- Create: `src/services/track-mapping.service.ts`
- Create: `src/services/track-mapping.service.test.ts`
- Modify: `src/services/db.service.ts`, `src/services.ts`, `src/container.ts`

- [x] add `track_map` accessors to `DbService`: read a row by `(source_type, source_id, target_type)`,
      upsert a resolution, upsert a negative result, and count resolved versus unresolved
- [x] create `TrackMappingService` with dependencies `dbService`, `spotifyService`, `logService`,
      `now`, exposing `resolve(sourceType, sourceTracks): Promise<Map<string, string>>` returning
      source id to target URI for everything currently resolvable
- [x] apply the retry policy: search only when there is no row, or the row is negative and
      `last_tried_at` is older than 24 hours; always update `last_tried_at` and `attempts`
- [x] write tests with a stubbed `SpotifyService` and a fixed `now`: an unmapped track is searched
      once and stored; a mapped track issues **zero** searches on the next call; a negative row within
      24 hours issues zero searches; a negative row older than 24 hours is retried; a later successful
      retry clears the negative state
- [x] Gate G passes

### Task 10: Provenance-driven sync

**Files:**
- Modify: `src/services/sync.service.ts`
- Modify: `src/services/db.service.ts`
- Modify: `src/entities/sync-run.entity.ts`
- Modify: `src/services/sync.service.test.ts`, `src/entities/sync-run.entity.test.ts`
- ➕ Modify: `src/services/music-providers/base-music.service.ts`,
  `src/services/music-providers/spotify.service.ts`,
  `src/services/music-providers/yandex-music.service.ts`,
  `src/services/music-providers/spotify.service.test.ts` - step 8 needs how many times a URI occurs in
  the target, which `getPlaylistTracks` deliberately discards, so `getPlaylistTrackUris(playlist)` was
  added to `BaseMusicService` (Spotify returns every entry URI in playlist order with the same
  null/non-track/local skips; Yandex throws `Method not implemented.` like its other write members)
- ➕ Modify: `src/services/db.service.test.ts`, `src/services/health.service.test.ts`,
  `src/controllers/health.controller.test.ts`, `src/services/notifications/notifier.test.ts`,
  `src/services/notifications/sync-summary.test.ts` - `removed` and `adopted` are required fields, so
  every `PlaylistRunResult` literal in the suite gains them

- [x] add `playlist_state` accessors to `DbService`: list rows for a playlist, insert a row, delete
      rows by URI
- [x] rewrite the per-target section of `SyncService.sync` to follow the eight numbered steps of the
      sync algorithm in Technical Details, replacing `findTracksInService`, `filterDuplicates`, and
      `removeDeletedTracks`
- [x] extend `PlaylistRunResult` with `removed: number` and `adopted: number`, populated in every
      branch including the error branch
- [x] write tests with stubs: an empty `playlist_state` yields **zero** removals even when the target
      holds tracks absent from the source; a source track that disappears causes exactly its recorded
      URI to be removed; a target track with no provenance row is never removed; a URI present three
      times is removed once and re-added once; adoption inserts provenance for already-present desired
      URIs
- [x] Gate G passes

### Task 11: /health reports auth state and mapping counts

**Files:**
- Modify: `src/services/health.service.ts`
- Modify: `src/services/health.service.test.ts`, `src/controllers/health.controller.test.ts`

- [x] replace `spotifyReady` with `spotify: { state }` sourced from `SpotifyAuthService`, and add
      `mapping: { resolved, unresolved }` from `DbService`
- [x] write tests: each of the three auth states maps through; counts come from the database; the
      serialized body contains no `accounts.spotify.com` substring
- [x] Gate G passes

### Task 12: Spotify callback with state verification

**Files:**
- Modify: `src/controllers/spotify.controller.ts`
- Create: `src/controllers/spotify.controller.test.ts`

- [ ] depend on `spotifyAuthService`; validate `code` presence, handle the `error` query parameter,
      and pass `state` into `exchangeCode`
- [ ] respond `400` with a clear message for a missing `code`, a present `error`, or a `state`
      mismatch; `200` only on success, still triggering `cronService.triggerAllJobs()`
- [ ] write tests: success returns `200` and triggers jobs; missing `code` returns `400`;
      `error=access_denied` returns `400`; wrong `state` returns `400` and does not trigger jobs
- [ ] Gate G passes

### Task 13: Container wiring and startup sequence

**Files:**
- Modify: `src/index.ts`, `src/container.ts`, `src/services.ts`
- Modify: `src/services/music-providers/spotify.service.ts`

- [ ] implement this exact startup order in `src/index.ts`: build the container; call
      `httpService.start()`; load the sync config inside a try/catch that logs and calls
      `process.exit(1)` on failure; `await spotifyAuthService.initialize()` which never throws and
      never exits; register the cron job; call `cleanup(...)`
- [ ] remove the delegating shims added in Task 6 from `SpotifyService`, keeping only the derived
      `get isReady()`
- [ ] register `trackMappingService`; confirm every constructor parameter name matches its
      registration
- [ ] write a test that `SyncService` records a `failed` run with a legible reason when the auth state
      is `needs-reauthorization`, without throwing
- [ ] Gate G passes

### Task 14: Process liveness

**Files:**
- Modify: `src/utils/cleanup.ts`, `src/index.ts`
- Create: `src/utils/cleanup.test.ts`

- [ ] change the signature to `cleanup(beforeExit: () => void, exitFn: () => void = () => process.exit(0)): void`
      so the handler is testable; `src/index.ts` keeps its single-argument call
- [ ] register handlers for `SIGINT`, `SIGTERM`, `SIGUSR1`, `SIGUSR2`, each running `beforeExit()`
      then `exitFn()`; `SIGTERM` is currently unhandled although `docker stop` sends it
- [ ] delete the `uncaughtException` handler, which logs and then calls `exitHandler.bind(...)`
      without invoking it, and remove the `process.stdin.resume()` leftover
- [ ] write a test passing a recording `exitFn` and emitting each signal, asserting both callbacks ran
- [ ] Gate G passes

### Task 15: Remove dead code and dependencies

**Files:**
- Delete: `src/utils/retry.ts`
- Modify: `src/utils.ts`, `src/config/sync-config.ts`, `src/config/sync-config.test.ts`,
  `src/services/sync.service.test.ts`, `sync-config.json`, `package.json`, `pnpm-lock.yaml`

- [ ] delete `src/utils/retry.ts` and its barrel export - retry policy now lives in two specialized
      places
- [ ] remove `excludedTrackIds` from the `PlaylistConfig` type, the yup schema, `sync-config.json`,
      and the test fixtures; it is read by no line of code
- [ ] remove `spotify-web-api-node` and `@types/spotify-web-api-node`, then run `pnpm install` and
      commit the updated `pnpm-lock.yaml`
- [ ] verify `grep -rn "spotify-web-api-node\|lowdb\|excludedTrackIds\|utils/retry" src package.json`
      returns nothing and `grep -c "lowdb\|spotify-web-api-node" pnpm-lock.yaml` returns 0
- [ ] Gate G passes

### Task 16: Verify acceptance criteria

- [ ] `spotify-auth.service.test.ts` has a test asserting `initialize()` resolves (does not reject)
      when the token endpoint answers `400 invalid_grant`, that the state becomes
      `needs-reauthorization`, and that a logged message contains `accounts.spotify.com/authorize`
- [ ] `spotify-auth.service.test.ts` asserts zero retry attempts on `invalid_grant` and exactly the
      delay sequence 500/1000/2000 on `5xx`
- [ ] `grep -rn "/playlists/" src --include="*.ts"` shows only `/items` paths and no `/tracks`
- [ ] `spotify.service.test.ts` asserts add and remove of 250 URIs each produce 100/100/50 request
      bodies and that the remove body uses the `items` key
- [ ] `sync.service.test.ts` asserts that with an empty `playlist_state` no removal request is issued
      regardless of target contents
- [ ] `track-mapping.service.test.ts` asserts a second run over the same source issues zero search
      requests
- [ ] `health.controller.test.ts` asserts `200` with `spotify.state` present in every auth state
- [ ] Gate G passes on a clean checkout

### Task 17: [Final] Update documentation

- [ ] update `README.md`: the service stays alive when the refresh token expires, reports
      `needs-reauthorization` in `/health`, and prints the re-authorization link to the log; note the
      180-day refresh token lifetime; note that state now lives in a SQLite database under `DB_PATH`
- [ ] this work adds no environment variables; leave the env-var table unchanged
- [ ] drop the `excludedTrackIds` mention from the configuration example
- [ ] move this plan to `docs/plans/completed/`
- [ ] Gate G passes

## Post-Completion

*Manual or external - no checkboxes.*

**Deploy and recovery:**

- build and publish the image (the `Publish` workflow, run manually via `workflow_dispatch`), then
  update the service on the `lasso` host
- the container must come up and **not** crash-loop despite the dead token in the volume
- take the authorize URL from `docker logs playlist-synchronizer`, open it, authorize; the callback
  lands on the configured redirect URI
- the first run backfills `track_map` (roughly 264 searches, one time) and adopts provenance; it must
  remove nothing

**Settle the unresolved hypothesis:** once a user token exists, re-probe whether `artist.followers`,
`artist.popularity`, and `track.popularity` are present and whether `/search` accepts `limit` above
10. Record the answer in the README. The code is written to work either way, so this is
informational, not a fix.

**Known leftovers, deliberately not automated:** 8 tracks currently in the target playlist left the
source before provenance existed (`Не вернусь`, `Miami 96`, `так похуй`, `колокола`, `Deathstrip`,
`Каждый День`, `Типок`, `ДАЖЕ ЕСЛИ`). The system will never remove them because it did not record
adding them. Remove them by hand if desired.

**Separate follow-ups:**

- the production compose on `lasso` has drifted from the repository (it defines `NOTIFY_URL`,
  `NOTIFY_SECRET`, `YANDEX_API_PROXY`, and two `.bak` files sit beside it); `make update` runs
  `git pull` on the host and will collide with this
- production sets `JOB_CRON_TIME` while the code reads `JOB_CRON_PATTERN` (`src/config/config.ts:60`),
  so the schedule is silently ignored and only matches by accident of the `@hourly` default
- consider tightening the external uptime check with a condition on `[BODY].spotify.state`
