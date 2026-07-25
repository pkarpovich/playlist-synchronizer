# Playlist Synchronizer

## Description
The app allows to synchronize of playlists from one service to others.

## Supported music services
- Spotify
- Yandex Music

## Requirements
- Node 24 (managed via `mise`, see `mise.toml`)

## Deploy
The service runs on the host as a git checkout with `compose.yaml` at the repo root, behind the
shared Traefik gateway (external docker network `proxy`, TLS terminated at the edge). Images are
published to `ghcr.io/pkarpovich/playlist-synchronizer` by the publish workflow on push to `main`,
so `latest` always matches `main`.

Deploys use [Spot](https://github.com/umputun/spot). The `deploy` task clones the repo if missing,
`git pull`s, `docker compose pull`s the latest image, and `docker compose up -d`. The target host is
in `inventory.yml`.

```sh
mise run deploy                               # uses ~/.ssh/id_ed25519
SSH_KEY=/path/to/other/key mise run deploy    # override the key
```

On the host, `~/playlist-synchronizer/.env` must carry `DOMAIN`, `HTTP_PORT`, the three `SPOTIFY_*`
values, `JOB_CRON_PATTERN`, and - for this deployment - `YANDEX_API_PROXY`, `NOTIFY_URL` and
`NOTIFY_SECRET`. `sync-config.json` is per-host: mark it with
`git update-index --skip-worktree sync-config.json` in the checkout so a local playlist
configuration survives `git pull`.

## State
All state lives in a SQLite database at `<DB_PATH>/sync.db`, opened through the built-in
`node:sqlite` module. It holds three collections:

- the Spotify auth record (refresh token, revocation timestamp, pending OAuth state)
- `track_map` - the source track to Spotify URI mapping. A track that resolves is searched for once
  and never again; a track that resolves to nothing is recorded as a miss and re-searched at most
  once per 24 hours, unless it has been confirmed absent with `cli.js skip`, after which it is never
  searched again
- `playlist_state` - what this app added to each target playlist on behalf of each source playlist,
  which is what removals are driven from. Rows are scoped by source playlist, so two sources feeding
  one target only ever reap their own tracks. On the first run every source-matched track already in
  the target is adopted into this table, so the switchover removes nothing. Tracks with no row here
  are never removed, so unrelated
  manual additions survive syncing. A URI present more than once is the one exception: it is deleted
  and re-added once, because Spotify removes every occurrence of a URI at once.

A refresh token left over from the previous lowdb store (`<DB_PATH>/db.json`) is imported once at
startup; that file is left on disk untouched.

## Correcting a mapping
Because a resolved track is searched for exactly once, a wrong match would otherwise stay wrong
forever. `cli.js` edits `track_map` directly, against the same database the service uses:

```sh
docker exec playlist-synchronizer node /app/cli.js list
docker exec playlist-synchronizer node /app/cli.js list --unresolved
docker exec playlist-synchronizer node /app/cli.js map 145513389 spotify:track:3fvTuOnHeSB2OGXNqsmVnd
docker exec playlist-synchronizer node /app/cli.js unmap 145513389
docker exec playlist-synchronizer node /app/cli.js skip 145513389
docker exec playlist-synchronizer node /app/cli.js unskip 145513389
```

`list` prints the source id, the stored title and the target URI, so a wrong row can be found
without reading the source playlist. The source id is also included in the "not found" log line.

`map` pins a source track to a Spotify URI; it accepts only `spotify:track:...`, keeps the stored
title, and clears the ISRC and duration since those described the previous target. `unmap` drops
the row so the next run resolves it again.

`skip` records that a track is genuinely absent from Spotify. An unresolved track is otherwise
re-searched every 24 hours forever and keeps counting towards `mapping.unresolved` and the
"not found" figure in the notification digest; a skipped one is never searched again, is counted
under `mapping.skipped`, and drops out of `notFound`. `unskip` reverses it, and `map` on a skipped
track resumes it implicitly. A skipped track is not an error: runs stay `ok`, exactly as they
already did for unresolved ones.

Nothing else needs to happen: the running service reads `track_map` on every sync, so the next
scheduled run picks the change up. The database file is on the `auth-store` volume, so edits
survive restarts but not a volume wipe.

## Spotify authorization
Spotify's refresh token has a **180-day lifetime**, so re-authorization is a recurring, expected
event rather than an outage.

When the token expires, the token endpoint answers `400 invalid_grant`. The service **stays alive**:
it discards the dead token, moves to the `needs-reauthorization` state, and keeps serving HTTP.

- `GET /health` reports `spotify: { state }`, one of `not-authorized`, `authorized`,
  `needs-reauthorization`, plus `mapping: { resolved, unresolved }`. This replaces the former
  `spotifyReady: boolean`, which is gone.
- the re-authorization link is printed **to the log only** (`docker logs playlist-synchronizer`) and
  never to `/health` or a notification channel, because it carries a single-use `state` value
- opening that link and authorizing hits `SPOTIFY_REDIRECT_URI`, which verifies the `state`, stores
  the new refresh token, and triggers a sync run

Sync runs while unauthorized are recorded as failed with the reason; they do not crash the process.

## Environment variables
Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` | yes | Spotify OAuth app credentials (sync target). |
| `DB_PATH` | no | Directory holding `sync.db`. Created when missing, defaults to `./db`, and is the mounted volume (`/app/db`) in Docker. |
| `YANDEX_API_PROXY` | recommended | SOCKS5 proxy URL (e.g. `socks5h://host:port`) egressing from a RU/CIS box. `api.music.yandex.net` is geo-blocked elsewhere, so leaving this empty fetches directly and fails outside RU/CIS. |
| `YANDEX_API_BASE_URL` | no | Override the Yandex API base URL. Defaults to `https://api.music.yandex.net`. |
| `NOTIFY_URL` | no | tg-relay `/send` endpoint (e.g. `https://relay.pkarpovich.space/send`). When set, each sync run that has something to report (tracks added, a failed playlist, or an empty source) posts a Markdown status card; runs with nothing notable stay silent. Leave empty to disable notifications. |
| `NOTIFY_SECRET` | no | `X-Secret` header value sent with the notification POST. Only used when `NOTIFY_URL` is set. |

## Config example
`sync-config.json`
```json
{
  "playlists": [
    {
      "type": "yandex",
      "metadata": {
        "id": "1004",
        "userName": "flomaster-mc",
        "name": "РЗТ Mainstream 2022"
      },
      "targetPlaylists": [
        {
          "type": "spotify",
          "metadata": {
            "id": "5hawKrDsYBhjPKP88E8avR",
            "name": "Spotify РЗТ Mainstream 2022"
          }
        }
      ]
    }
  ]
}
```

## Node scripts:

### `pnpm build`
Build the app for production.

### `pnpm start`
Run the app in production mode.

### `pnpm dev`
Run the app in development mode.

### `pnpm test`
Run the unit test suite (`node:test` via `tsx`).
