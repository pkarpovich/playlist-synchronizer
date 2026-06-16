import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import express from 'express';

import { HealthController } from './health.controller.js';
import { HealthService, HealthSnapshot } from '../services.js';

function makeSnapshot(): HealthSnapshot {
    return {
        status: 'partial',
        lastSyncAt: '2026-06-16T12:00:00.000Z',
        ageSeconds: 90,
        spotifyReady: true,
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
