# Playlist Synchronizer

## Description
The app allows to synchronize of playlists from one service to others.

## Supported music services
- Spotify
- Yandex Music

## Requirements
- Node 24 (managed via `mise`, see `mise.toml`)

## Environment variables
Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` | yes | Spotify OAuth app credentials (sync target). |
| `YANDEX_API_PROXY` | recommended | SOCKS5 proxy URL (e.g. `socks5h://host:port`) egressing from a RU/CIS box. `api.music.yandex.net` is geo-blocked elsewhere, so leaving this empty fetches directly and fails outside RU/CIS. |
| `YANDEX_API_BASE_URL` | no | Override the Yandex API base URL. Defaults to `https://api.music.yandex.net`. |

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
      "excludedTrackIds": [],
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
