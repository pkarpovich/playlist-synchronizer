import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { LastRun, PlaylistRunResult, RunStatus } from '../../entities.js';
import { PlaylistLine, summarizeRun } from './sync-summary.js';

function playlist(overrides: Partial<PlaylistRunResult>): PlaylistRunResult {
    return {
        name: 'Playlist',
        status: 'ok',
        sourceTracks: 0,
        matched: 0,
        added: 0,
        notFound: 0,
        ...overrides,
    };
}

function lastRun(status: RunStatus, playlists: PlaylistRunResult[]): LastRun {
    return {
        startedAt: 1000,
        finishedAt: 6000,
        durationMs: 5000,
        status,
        playlists,
    };
}

test('summarizeRun returns null for a null run', () => {
    assert.equal(summarizeRun(null), null);
});

test('summarizeRun reports an ok playlist with additions and notFound', () => {
    const summary = summarizeRun(
        lastRun('ok', [
            playlist({ name: 'Mix', status: 'ok', added: 3, notFound: 2 }),
        ]),
    );

    assert.deepEqual(summary, {
        verdict: 'ok',
        lines: [{ name: 'Mix', kind: 'added', added: 3, notFound: 2 }],
    });
});

test('summarizeRun skips an ok playlist with zero additions', () => {
    const summary = summarizeRun(
        lastRun('ok', [playlist({ name: 'Mix', status: 'ok', added: 0 })]),
    );

    assert.equal(summary, null);
});

test('summarizeRun skips an ok playlist with zero additions even when notFound is positive', () => {
    const summary = summarizeRun(
        lastRun('ok', [
            playlist({ name: 'Mix', status: 'ok', added: 0, notFound: 5 }),
        ]),
    );

    assert.equal(summary, null);
});

test('summarizeRun reports a failed playlist with its error', () => {
    const summary = summarizeRun(
        lastRun('failed', [
            playlist({
                name: 'Workout',
                status: 'failed',
                error: 'services not ready',
            }),
        ]),
    );

    assert.deepEqual(summary, {
        verdict: 'failed',
        lines: [
            { name: 'Workout', kind: 'failed', error: 'services not ready' },
        ],
    });
});

test('summarizeRun reports a failed playlist without an error', () => {
    const summary = summarizeRun(
        lastRun('failed', [playlist({ name: 'Workout', status: 'failed' })]),
    );

    assert.deepEqual(summary, {
        verdict: 'failed',
        lines: [{ name: 'Workout', kind: 'failed', error: undefined }],
    });
});

test('summarizeRun reports an empty-source playlist', () => {
    const summary = summarizeRun(
        lastRun('failed', [
            playlist({ name: 'Discover Weekly', status: 'empty-source' }),
        ]),
    );

    assert.deepEqual(summary, {
        verdict: 'failed',
        lines: [{ name: 'Discover Weekly', kind: 'empty-source' }],
    });
});

test('summarizeRun keeps the verdict and notable lines for a mixed run', () => {
    const summary = summarizeRun(
        lastRun('partial', [
            playlist({ name: 'Risa', status: 'ok', added: 3, notFound: 2 }),
            playlist({ name: 'Steady', status: 'ok', added: 0, notFound: 4 }),
            playlist({
                name: 'Chill Mix',
                status: 'ok',
                added: 2,
                notFound: 0,
            }),
            playlist({
                name: 'Workout',
                status: 'failed',
                error: 'services not ready',
            }),
            playlist({ name: 'Discover Weekly', status: 'empty-source' }),
        ]),
    );

    const expected: PlaylistLine[] = [
        { name: 'Risa', kind: 'added', added: 3, notFound: 2 },
        { name: 'Chill Mix', kind: 'added', added: 2, notFound: 0 },
        { name: 'Workout', kind: 'failed', error: 'services not ready' },
        { name: 'Discover Weekly', kind: 'empty-source' },
    ];

    assert.deepEqual(summary, { verdict: 'partial', lines: expected });
});

test('summarizeRun returns null when every ok playlist has zero additions', () => {
    const summary = summarizeRun(
        lastRun('ok', [
            playlist({ name: 'One', status: 'ok', added: 0 }),
            playlist({ name: 'Two', status: 'ok', added: 0, notFound: 1 }),
        ]),
    );

    assert.equal(summary, null);
});
