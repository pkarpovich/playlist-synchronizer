# playlist-synchronizer

## 1.5.0

### Minor Changes

-   #69: rewrite `/health` into a passive sync-health facts endpoint - records the last run (per-playlist results), always returns HTTP 200, and leaves freshness thresholds to the consumer
-   #70: add per-run sync notifications - posts an `md` status card to a tg-relay `/send` (added tracks, not-found-in-Spotify counts, failures), gated on `NOTIFY_URL`, best-effort and never blocks the sync

## 1.4.0

### Minor Changes

-   #67: restore Yandex source via the official `api.music.yandex.net` over a SOCKS proxy (public playlists, no token); fail-loud source errors so a failing playlist is skipped instead of reported as a false success
-   #68: upgrade major dependencies and Node 24.16 (express 5, awilix 13, croner 10, dotenv 17, prettier 3, TypeScript 6, husky 9, lint-staged 17); rewrite GitHub Actions into a single manual publish workflow; remove changesets

## 1.3.0

### Minor Changes

-   126b27d: upgrade Node.js to v22 and pnpm to v10

## 1.2.2

### Patch Changes

-   9bf3ad7: Fine-tune spotify search query requests
-   ca15e1c: Update all dependencies

## 1.2.1

### Patch Changes

-   59536ed: Add tracks by chunk to spotify playlist
-   8ae5514: Add paging support for spotify service
-   7b49b36: Update all dependencies
-   7b49b36: Remove duplicates from target playlist

## 1.2.0

### Minor Changes

-   72c32ff: Remove deleted tracks from target playlist
-   2dc83e2: Add cache layer for Spotify client

### Patch Changes

-   2dc83e2: Update dependencies

## 1.1.13

### Patch Changes

-   2689cfc: Move deploy docker image into build action

## 1.1.12

### Patch Changes

-   1f34050: Fix update docker image trigger

## 1.1.11

### Patch Changes

-   37cce37: Fix update docker image trigger

## 1.1.10

### Patch Changes

-   251abb8: Add update docker image github action

## 1.1.9

### Patch Changes

-   c73565b: Fix docker publish script

## 1.1.8

### Patch Changes

-   299e8d4: Change token owner
-   7f68fcf: Change release trigger

## 1.1.7

### Patch Changes

-   562d915: Change release tag trigger

## 1.1.6

### Patch Changes

-   3ae5155: Change owner of releases

## 1.1.5

### Patch Changes

-   d897a9a: Fix on push tags action

## 1.1.4

### Patch Changes

-   16f4155: Change trigger event for build image action

## 1.1.3

### Patch Changes

-   2e33954: Change trigger event for build image action

## 1.1.2

### Patch Changes

-   083bc14: Add new release types for docker image publish action

## 1.1.1

### Patch Changes

-   3defbd8: Add docker publish github action

## 1.1.0

### Minor Changes

-   84a569a: First changeset
