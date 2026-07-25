# Playlist Synchronizer

## Description
The app allows to synchronize of playlists from one service to others.

## Supported music services
- Spotify
- Yandex Music

## Requirements
- Node 24 (managed via `mise`, see `mise.toml`)

## State
All state lives in a SQLite database at `<DB_PATH>/sync.db`, opened through the built-in
`node:sqlite` module. It holds three collections:

- the Spotify auth record (refresh token, revocation timestamp, pending OAuth state)
- `track_map` - the source track to Spotify URI mapping, so a track is searched for once and never
  again
- `playlist_state` - what this app added to each target playlist, which is what removals are driven
  from. Tracks the app did not add are never removed, so manual additions survive syncing.

A refresh token left over from the previous lowdb store (`<DB_PATH>/db.json`) is imported once at
startup; that file is left on disk untouched.

## Spotify authorization
Spotify's refresh token has a **180-day lifetime**, so re-authorization is a recurring, expected
event rather than an outage.

When the token expires, the token endpoint answers `400 invalid_grant`. The service **stays alive**:
it discards the dead token, moves to the `needs-reauthorization` state, and keeps serving HTTP.

- `GET /health` reports `spotify: { state }`, one of `not-authorized`, `authorized`,
  `needs-reauthorization`, plus `mapping: { resolved, unresolved }`
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
