import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import express from 'express';

import { HealthController } from './health.controller.js';
import {
    HealthService,
    HealthSnapshot,
    SpotifyAuthState,
} from '../services.js';

function makeSnapshot(state: SpotifyAuthState = 'authorized'): HealthSnapshot {
    return {
        status: 'partial',
        lastSyncAt: '2026-06-16T12:00:00.000Z',
        ageSeconds: 90,
        spotify: { state },
        mapping: { resolved: 3, unresolved: 1 },
        lastRun: {
            startedAt: 1,
            finishedAt: 2,
            durationMs: 1,
            status: 'partial',
            playlists: [
                {
                    name: 'Source',
                    status: 'ok',
                    sourceTracks: 3,
                    matched: 3,
                    added: 1,
                    removed: 0,
                    adopted: 0,
                    notFound: 0,
                },
            ],
        },
    };
}

function makeResponse(): {
    res: express.Response;
    statusCode: number | null;
    body: unknown;
} {
    const captured: { statusCode: number | null; body: unknown } = {
        statusCode: null,
        body: undefined,
    };
    const res = {
        status(code: number) {
            captured.statusCode = code;
            return this;
        },
        json(payload: unknown) {
            captured.body = payload;
            return this;
        },
    } as unknown as express.Response;

    return {
        res,
        get statusCode() {
            return captured.statusCode;
        },
        get body() {
            return captured.body;
        },
    };
}

test('healthCheck responds 200 with the health snapshot', async () => {
    const snapshot = makeSnapshot();
    const healthService = {
        snapshot: () => snapshot,
    } as unknown as HealthService;
    const controller = new HealthController(healthService);
    const result = makeResponse();

    await controller.healthCheck({} as express.Request, result.res);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, snapshot);
});

test('healthCheck responds 200 with the auth state in every state', async () => {
    const states: SpotifyAuthState[] = [
        'not-authorized',
        'authorized',
        'needs-reauthorization',
    ];

    for (const state of states) {
        const healthService = {
            snapshot: () => makeSnapshot(state),
        } as unknown as HealthService;
        const controller = new HealthController(healthService);
        const result = makeResponse();

        await controller.healthCheck({} as express.Request, result.res);

        assert.equal(result.statusCode, 200);
        assert.equal((result.body as HealthSnapshot).spotify.state, state);
    }
});
