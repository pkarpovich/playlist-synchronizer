# Playlist Synchronizer

## Description
The app allows to synchronize of playlists from one service to others.

## Supported music services
- Spotify
- Yandex Music

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
