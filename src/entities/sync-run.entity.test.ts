import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
    computeRunStatus,
    PlaylistRunResult,
    PlaylistRunStatus,
} from './sync-run.entity.js';

function result(status: PlaylistRunStatus): PlaylistRunResult {
    return {
        name: status,
        status,
        sourceTracks: 0,
        matched: 0,
        added: 0,
        notFound: 0,
    };
}

test('computeRunStatus returns ok when every playlist is ok', () => {
    assert.equal(computeRunStatus([result('ok'), result('ok')]), 'ok');
});

test('computeRunStatus returns partial when some are ok and some are not', () => {
    assert.equal(computeRunStatus([result('ok'), result('failed')]), 'partial');
    assert.equal(
        computeRunStatus([result('ok'), result('empty-source')]),
        'partial',
    );
});

test('computeRunStatus returns failed when no playlist is ok', () => {
    assert.equal(
        computeRunStatus([result('failed'), result('empty-source')]),
        'failed',
    );
});

test('computeRunStatus treats an empty playlist list as ok (no failures)', () => {
    assert.equal(computeRunStatus([]), 'ok');
});
