import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LastRun } from '../entities.js';
import { DbService, TrackMapCounts } from './db.service.js';
import {
    SpotifyAuthService,
    SpotifyAuthState,
} from './music-providers/spotify-auth.service.js';
import { SyncService } from './sync.service.js';
import { HealthService } from './health.service.js';

const NoCounts: TrackMapCounts = { resolved: 0, unresolved: 0 };

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
                removed: 0,
                adopted: 0,
                notFound: 0,
            },
            {
                name: 'Bad Source',
                status: 'failed',
                sourceTracks: 0,
                matched: 0,
                added: 0,
                removed: 0,
                adopted: 0,
                notFound: 0,
                error: 'source unavailable',
            },
        ],
    };
}

function makeHealthService(
    lastRun: LastRun | null,
    state: SpotifyAuthState,
    counts: TrackMapCounts,
    now: number,
): HealthService {
    const syncService = { lastRun } as unknown as SyncService;
    const spotifyAuthService = {
        state,
        buildAuthorizeUrl: () =>
            'https://accounts.spotify.com/authorize?state=secret',
    } as unknown as SpotifyAuthService;
    const dbService = {
        countTrackMap: () => counts,
    } as unknown as DbService;

    return new HealthService(
        syncService,
        spotifyAuthService,
        dbService,
        () => now,
    );
}

test('snapshot maps the last run with a fixed now', () => {
    const finishedAt = Date.UTC(2026, 5, 16, 12, 0, 0);
    const now = finishedAt + 90_000;
    const health = makeHealthService(
        makeLastRun(finishedAt),
        'authorized',
        NoCounts,
        now,
    );

    const snap = health.snapshot();

    assert.equal(snap.status, 'partial');
    assert.equal(snap.lastSyncAt, '2026-06-16T12:00:00.000Z');
    assert.equal(snap.ageSeconds, 90);
    assert.deepEqual(snap.spotify, { state: 'authorized' });
    assert.equal(snap.lastRun?.playlists.length, 2);
});

test('snapshot reports the no-run state before any run', () => {
    const health = makeHealthService(
        null,
        'not-authorized',
        NoCounts,
        Date.UTC(2026, 5, 16),
    );

    const snap = health.snapshot();

    assert.equal(snap.status, 'no-run');
    assert.equal(snap.lastSyncAt, null);
    assert.equal(snap.ageSeconds, null);
    assert.deepEqual(snap.spotify, { state: 'not-authorized' });
    assert.equal(snap.lastRun, null);
});

test('snapshot floors a partial-second age', () => {
    const finishedAt = Date.UTC(2026, 5, 16, 12, 0, 0);
    const now = finishedAt + 1900;
    const health = makeHealthService(
        makeLastRun(finishedAt),
        'authorized',
        NoCounts,
        now,
    );

    assert.equal(health.snapshot().ageSeconds, 1);
});

test('snapshot reports every Spotify auth state', () => {
    const states: SpotifyAuthState[] = [
        'not-authorized',
        'authorized',
        'needs-reauthorization',
    ];

    for (const state of states) {
        const health = makeHealthService(null, state, NoCounts, 0);

        assert.equal(health.snapshot().spotify.state, state);
    }
});

test('snapshot reports mapping counts from the database', () => {
    const health = makeHealthService(
        null,
        'authorized',
        { resolved: 261, unresolved: 3 },
        0,
    );

    assert.deepEqual(health.snapshot().mapping, {
        resolved: 261,
        unresolved: 3,
    });
});

test('snapshot never carries the authorize URL', () => {
    const finishedAt = Date.UTC(2026, 5, 16, 12, 0, 0);

    for (const state of ['not-authorized', 'needs-reauthorization'] as const) {
        const health = makeHealthService(
            makeLastRun(finishedAt),
            state,
            NoCounts,
            finishedAt,
        );

        const body = JSON.stringify(health.snapshot());

        assert.equal(body.includes('accounts.spotify.com'), false);
    }
});
