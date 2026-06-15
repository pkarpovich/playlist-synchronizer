# Dependency upgrade: majors (except eslint) + drop changesets

## Overview
Bring playlist-synchronizer dependencies up to date, including major versions,
EXCEPT the eslint ecosystem (frozen on purpose - eslint 10 flat-config migration is
deliberately out of scope). Also remove changesets entirely (no value here) and
rewrite the GitHub Actions: delete the old workflows and replace them with a single
manual (`workflow_dispatch`) image-publish workflow matching the manual deploy flow
(no automatic triggers).

This plan runs AFTER the Yandex-source plan
(`docs/plans/20260615-yandex-source-official-api-socks.md`) is merged. It assumes
that work already landed: Node 24.16 (via mise), `typescript@5.9.3`,
`@types/node@^24`, `node:test` harness, `fetch-socks`, `yandex-short-api` removed.

NOTE: this file lives in `/tmp` to avoid interfering with the in-flight ralphex run
on the Yandex plan. Move it into `docs/plans/` once that plan completes so ralphex
can execute it.

## Context (from discovery)
- `pnpm outdated` majors in scope: express 4->5, awilix 12->13, croner 9->10,
  dotenv 16->17, prettier 2->3, husky 8->9, lint-staged 13->17, typescript 5.9->6.0;
  plus safe minors: helmet 8.2, yup 1.7, tsx 4.22.
- FROZEN (do not touch): `eslint`, `@typescript-eslint/*`, `eslint-config-prettier`,
  `eslint-plugin-prettier`, `eslint-import-resolver-typescript`, `eslint-plugin-import`.
- Keep `@types/node` on `^24` (match Node 24.16 runtime; do NOT go to 25).
- Changesets removal touches: `@changesets/cli` dep, `.changeset/` dir,
  `package.json` scripts (`changeset`, `version`, `publish`) + `publishConfig`.
- GitHub Actions rewrite: delete ALL current workflows - `release.yml` (changesets),
  `publish-docker-image.yml` (old, hardcoded `TAG_NAME: 1.3.0`, needs `PKG_TOKEN`),
  `update-lockfile.yml` (dependabot pnpm-lock, `pull_request_target` + write). Replace
  with one manual `publish.yml`. Deploy stays manual (no push/release triggers).
- Code touch points verified low-impact:
  - express 5: routes have no wildcards (`/callback`,`/`,`/spotify`,`/health`); no
    `req.body`/`app.del` use; async errors auto-caught -> drop `express-async-errors`.
  - awilix 13: TS-only changes; we use `createContainer<Container>()` explicitly.
  - croner 10: `new Cron`/`.trigger()`/`.stop()` unchanged; only pattern parsing is
    stricter (`?` is now wildcard; non-standard steps need `sloppyRanges`). Default
    pattern is `@hourly` (safe) - confirm prod `JOB_CRON_PATTERN`.
  - typescript 6.0: largest breaking since 2.0 (removed ES5 target, amd/umd/system,
    `moduleResolution: classic`; `types` defaults to `[]`). We are ESM/NodeNext via
    `@tsconfig/node24`; watch the `types` default so node globals still resolve.

## Development Approach
- This is an UPGRADE plan, not feature work: there are no new units to TDD. "Tests"
  per task = a regression gate: `pnpm build`, `pnpm check-types`, `pnpm test` (the
  existing `node:test` suite), `pnpm lint` must stay green; for runtime bumps also a
  smoke check that the app boots (`pnpm dev` / `node dist/index.js` starts, `/health`
  responds).
- One major (or one tight group) per task; keep each task independently revertible.
- Do not touch the frozen eslint cluster. Keep `@types/node` at `^24`.
- Commit prettier reformat separately so review diffs stay readable.

## Testing Strategy
- Regression gate every task: build + check-types + existing test suite + lint green.
- Runtime bumps (express, awilix, croner, dotenv): add an app-boot smoke check.
- No new unit tests are expected (dependency/config changes); if a bump requires a
  code change, add/adjust a test for that change.

## Progress Tracking
- Mark `[x]` when done; `➕` for discovered tasks; `⚠️` for blockers. Keep in sync.

## What Goes Where
- Implementation Steps: dep bumps, config/code edits, verification the agent can run.
- Post-Completion: prod release-process decision (manual tag vs latest), live deploy.

## Implementation Steps

### Task 1: Safe minor bumps
- [x] bump `helmet` ^8.2, `yup` ^1.7, `tsx` ^4.22 in `package.json`; `pnpm install`
- [x] run `pnpm build`, `pnpm check-types`, `pnpm test`, `pnpm lint` - all green
- [x] smoke: app boots and `/health` responds

### Task 2: express 4 -> 5
- [x] bump `express` ^5 and `@types/express` ^5; remove `express-async-errors`
      (dep + its `import 'express-async-errors'` in `src/services/http.service.ts`)
- [x] verify the error handler `(err,req,res,next)` still catches a thrown error in
      an async route (Spotify callback path)
- [x] adjust any express-5 fallout (none expected: no wildcard routes, no `req.body`)
- [x] regression gate green; smoke: `/health` + `/spotify/callback` work
- [x] if a code change was needed, add a test covering it

### Task 3: awilix 13 + croner 10 + dotenv 17
- [x] bump `awilix` ^13, `croner` ^10, `dotenv` ^17; `pnpm install`
- [x] croner: confirm the configured `JOB_CRON_PATTERN` (default `@hourly`) parses
      under strict v10 rules; add `{ sloppyRanges: true }` only if a non-standard
      pattern is in use (default `@hourly` + standard `0 * * * *` both schedule under
      v10; no non-standard pattern in use, so `sloppyRanges` not added)
- [x] awilix: typecheck the `createContainer<Container>()` usage in `src/container.ts`
      (`pnpm check-types` clean; awilix 13 changes are TS-only, explicit generic still
      resolves)
- [x] regression gate green; smoke: cron job schedules and the app boots (build,
      check-types, 32 tests, lint all green; temp smoke booted the real container +
      HTTP layer: `/health` -> 200, `@hourly` job scheduled and `startNow` fired once)
- [x] add/adjust tests if any code change was required (the only code change was
      `dotenv.config({ quiet: true })` to silence dotenv 17's new promotional boot
      banner - a config flag with no testable logic; existing suite stays green)

### Task 4: prettier 2 -> 3 (isolated reformat)
- [ ] bump `prettier` ^3; run `pnpm format:fix`
- [ ] commit the reformat as its own commit (no logic changes)
- [ ] regression gate green (`pnpm lint`, `pnpm format`, build)

### Task 5: husky 9 + lint-staged 17
- [ ] bump `husky` ^9 and `lint-staged` ^17
- [ ] remove the dead husky v4-style `"husky": { "hooks": ... }` block from
      `package.json`; ensure `.husky/pre-commit` runs `pnpm lint-staged`
- [ ] drop the now-redundant `git add` from the `lint-staged` config (auto-staged)
- [ ] verify a test commit triggers the pre-commit hook (lint-staged runs)
- [ ] regression gate green

### Task 6: typescript 5.9 -> 6.0 (isolated, last)
- [ ] bump `typescript` ^6; `pnpm install`
- [ ] resolve TS 6 fallout: ensure `tsconfig.json` (via `@tsconfig/node24`) sets a
      valid `target`/`module` and includes `types: ["node"]` so node globals resolve
      under the new `types: []` default; fix any new type errors
- [ ] run `pnpm build` and `pnpm check-types` - must be clean
- [ ] regression gate green

### Task 7: Rewrite GitHub Actions (manual deploy) + remove changesets
- [ ] delete all existing workflows: `.github/workflows/release.yml`,
      `publish-docker-image.yml`, `update-lockfile.yml`
- [ ] remove changesets: `@changesets/cli` dep, the `.changeset/` directory, and the
      `changeset`/`version`/`publish` scripts + `publishConfig` in `package.json`
- [ ] add `.github/workflows/publish.yml`: `on: workflow_dispatch` only (manual, with
      an optional `tag` input), build + push to `ghcr.io/${{ github.repository }}`
      tagged `:latest` + short-sha (+ the optional tag), `platforms: linux/amd64`
      (deploy target is amd64), auth via `GITHUB_TOKEN`, using `docker/login-action`,
      `docker/metadata-action`, `docker/build-push-action`; no hardcoded version
- [ ] decide dependabot: keep `dependabot.yml` (security alerts) or remove it; the
      orphaned lockfile workflow is removed regardless
- [ ] `pnpm install`; regression gate green; `actionlint` / YAML sanity if available

### Task 8: Verify acceptance criteria
- [ ] no references to removed deps remain (`express-async-errors`, `@changesets/cli`,
      `.changeset`)
- [ ] `.github/workflows/` contains only `publish.yml` (old workflows gone); it has
      no automatic triggers (only `workflow_dispatch`)
- [ ] eslint cluster untouched (versions unchanged); `@types/node` still `^24`
- [ ] `pnpm build`, `pnpm check-types`, `pnpm test`, `pnpm lint` all green
- [ ] app boots; `/health` responds

## Technical Details
- express 5 auto-catches rejected promises in middleware/handlers, so
  `express-async-errors` is redundant and removed; the custom error handler is kept.
- croner 10 strict parsing: `?` is a wildcard now; `/N` stepping without a proper
  prefix needs `{ sloppyRanges: true }`. `@hourly` and standard patterns are fine.
- TS 6.0 `types: []` default: rely on `@tsconfig/node24`; add `types: ["node"]`
  explicitly if node globals (`process`, `Buffer`) stop resolving.
- After removing changesets, version bumps/tags are manual; image publishing stays in
  `publish-docker-image.yml`.

## Post-Completion
*Manual / external - no checkboxes.*

- Release/deploy is now fully manual: run the `publish.yml` workflow from the Actions
  UI (`workflow_dispatch`, optional `tag`) to build + push the image, then on the host
  `docker compose pull && docker compose up -d`. No automatic triggers.
- Confirm the running app is healthy after redeploy.
- Confirm the prod `JOB_CRON_PATTERN` parses under croner 10 (no `?`/sloppy steps).
