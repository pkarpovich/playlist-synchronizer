import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LastRun } from '../entities.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { SyncService } from './sync.service.js';
import { HealthService } from './health.service.js';

function makeLastRun(finishedAt: number): LastRun {
    return {
        startedAt: finishedAt - 5000,
        finishedAt,
        durationMs: 5000,
        status: 'partial',
        playlists: [
            {
                name: 'Good Source',
                status: 'ok',
                sourceTracks: 3,
                matched: 3,
                added: 1,
                notFound: 0,
            },
            {
                name: 'Bad Source',
                status: 'failed',
                sourceTracks: 0,
                matched: 0,
                added: 0,
                notFound: 0,
                error: 'source unavailable',
            },
        ],
    };
}

function makeHealthService(
    lastRun: LastRun | null,
    isReady: boolean,
    now: number,
): HealthService {
    const syncService = { lastRun } as unknown as SyncService;
    const spotifyService = { isReady } as unknown as SpotifyService;

    return new HealthService(syncService, spotifyService, () => now);
}

test('snapshot maps the last run with a fixed now', () => {
    const finishedAt = Date.UTC(2026, 5, 16, 12, 0, 0);
    const now = finishedAt + 90_000;
    const health = makeHealthService(makeLastRun(finishedAt), true, now);

    const snap = health.snapshot();

    assert.equal(snap.status, 'partial');
    assert.equal(snap.lastSyncAt, '2026-06-16T12:00:00.000Z');
    assert.equal(snap.ageSeconds, 90);
    assert.equal(snap.spotifyReady, true);
    assert.equal(snap.lastRun?.playlists.length, 2);
});

test('snapshot reports the no-run state before any run', () => {
    const health = makeHealthService(null, false, Date.UTC(2026, 5, 16));

    const snap = health.snapshot();

    assert.equal(snap.status, 'no-run');
    assert.equal(snap.lastSyncAt, null);
    assert.equal(snap.ageSeconds, null);
    assert.equal(snap.spotifyReady, false);
    assert.equal(snap.lastRun, null);
});

test('snapshot floors a partial-second age', () => {
    const finishedAt = Date.UTC(2026, 5, 16, 12, 0, 0);
    const now = finishedAt + 1900;
    const health = makeHealthService(makeLastRun(finishedAt), true, now);

    assert.equal(health.snapshot().ageSeconds, 1);
});
