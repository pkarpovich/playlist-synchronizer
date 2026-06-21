import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { renderDigest } from './render-digest.js';
import { RunSummary } from './sync-summary.js';

test('renderDigest renders an added-only line without a not-found suffix', () => {
    const summary: RunSummary = {
        verdict: 'ok',
        lines: [{ name: 'Chill Mix', kind: 'added', added: 2, notFound: 0 }],
    };

    assert.equal(
        renderDigest(summary),
        ['🎵 Playlist Sync', '---', '✅ Sync OK', '', '✅ Chill Mix: +2'].join(
            '\n',
        ),
    );
});

test('renderDigest appends the not-found suffix when notFound is positive', () => {
    const summary: RunSummary = {
        verdict: 'ok',
        lines: [
            {
                name: 'Риса за Творчество 2026',
                kind: 'added',
                added: 3,
                notFound: 2,
            },
        ],
    };

    assert.equal(
        renderDigest(summary),
        [
            '🎵 Playlist Sync',
            '---',
            '✅ Sync OK',
            '',
            '✅ Риса за Творчество 2026: +3 (2 not found in Spotify)',
        ].join('\n'),
    );
});

test('renderDigest renders a partial run with mixed kinds', () => {
    const summary: RunSummary = {
        verdict: 'partial',
        lines: [
            {
                name: 'Риса за Творчество 2026',
                kind: 'added',
                added: 3,
                notFound: 2,
            },
            { name: 'Chill Mix', kind: 'added', added: 2, notFound: 0 },
            { name: 'Workout', kind: 'failed', error: 'services not ready' },
            { name: 'Discover Weekly', kind: 'empty-source' },
        ],
    };

    assert.equal(
        renderDigest(summary),
        [
            '🎵 Playlist Sync',
            '---',
            '⚠️ Sync partial',
            '',
            '✅ Риса за Творчество 2026: +3 (2 not found in Spotify)',
            '✅ Chill Mix: +2',
            '❌ Workout: services not ready',
            '🕳 Discover Weekly: empty source',
        ].join('\n'),
    );
});

test('renderDigest renders a full-fail run', () => {
    const summary: RunSummary = {
        verdict: 'failed',
        lines: [{ name: 'Discover Weekly', kind: 'empty-source' }],
    };

    assert.equal(
        renderDigest(summary),
        [
            '🎵 Playlist Sync',
            '---',
            '❌ Sync failed',
            '',
            '🕳 Discover Weekly: empty source',
        ].join('\n'),
    );
});

test('renderDigest falls back to "failed" when a failed line has no error', () => {
    const summary: RunSummary = {
        verdict: 'failed',
        lines: [{ name: 'Workout', kind: 'failed' }],
    };

    assert.equal(
        renderDigest(summary),
        [
            '🎵 Playlist Sync',
            '---',
            '❌ Sync failed',
            '',
            '❌ Workout: failed',
        ].join('\n'),
    );
});

test('renderDigest maps each verdict to its word and emoji', () => {
    const lines: RunSummary['lines'] = [
        { name: 'Mix', kind: 'added', added: 1, notFound: 0 },
    ];

    assert.match(renderDigest({ verdict: 'ok', lines }), /^✅ Sync OK$/m);
    assert.match(
        renderDigest({ verdict: 'partial', lines }),
        /^⚠️ Sync partial$/m,
    );
    assert.match(
        renderDigest({ verdict: 'failed', lines }),
        /^❌ Sync failed$/m,
    );
});
