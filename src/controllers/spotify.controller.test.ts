import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import express from 'express';

import { SpotifyController } from './spotify.controller.js';
import { CronService, LogService, SpotifyAuthService } from '../services.js';

type ExchangeCall = { code: string; state: string | null };

function makeAuthService(exchange: (call: ExchangeCall) => void): {
    service: SpotifyAuthService;
    calls: ExchangeCall[];
} {
    const calls: ExchangeCall[] = [];
    const service = {
        async exchangeCode(code: string, state: string | null): Promise<void> {
            const call = { code, state };
            calls.push(call);
            exchange(call);
        },
    } as unknown as SpotifyAuthService;

    return { service, calls };
}

function makeCronService(): { service: CronService; triggered: number[] } {
    const triggered: number[] = [];
    const service = {
        triggerAllJobs(): void {
            triggered.push(1);
        },
    } as unknown as CronService;

    return { service, triggered };
}

function makeLogService(): LogService {
    return {
        info: () => undefined,
        warn: () => undefined,
        success: () => undefined,
        error: () => undefined,
    } as unknown as LogService;
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
        send(payload: unknown) {
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

function makeRequest(query: Record<string, string>): express.Request {
    return { query } as unknown as express.Request;
}

test('authCallback responds 200, exchanges the code with the state and triggers jobs', async () => {
    const auth = makeAuthService(() => undefined);
    const cron = makeCronService();
    const controller = new SpotifyController(
        auth.service,
        cron.service,
        makeLogService(),
    );
    const result = makeResponse();

    await controller.authCallback(
        makeRequest({ code: 'auth-code', state: 'pending-state' }),
        result.res,
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(auth.calls, [
        { code: 'auth-code', state: 'pending-state' },
    ]);
    assert.equal(cron.triggered.length, 1);
});

test('authCallback responds 400 when the code is missing', async () => {
    const auth = makeAuthService(() => undefined);
    const cron = makeCronService();
    const controller = new SpotifyController(
        auth.service,
        cron.service,
        makeLogService(),
    );
    const result = makeResponse();

    await controller.authCallback(
        makeRequest({ state: 'pending-state' }),
        result.res,
    );

    assert.equal(result.statusCode, 400);
    assert.equal(auth.calls.length, 0);
    assert.equal(cron.triggered.length, 0);
});

test('authCallback responds 400 when Spotify reports access_denied', async () => {
    const auth = makeAuthService(() => undefined);
    const cron = makeCronService();
    const controller = new SpotifyController(
        auth.service,
        cron.service,
        makeLogService(),
    );
    const result = makeResponse();

    await controller.authCallback(
        makeRequest({ error: 'access_denied', state: 'pending-state' }),
        result.res,
    );

    assert.equal(result.statusCode, 400);
    assert.equal(auth.calls.length, 0);
    assert.equal(cron.triggered.length, 0);
});

test('authCallback responds 400 and triggers no jobs when the state does not match', async () => {
    const auth = makeAuthService(() => {
        throw new Error(
            'Spotify authorization state does not match a pending authorization request',
        );
    });
    const cron = makeCronService();
    const controller = new SpotifyController(
        auth.service,
        cron.service,
        makeLogService(),
    );
    const result = makeResponse();

    await controller.authCallback(
        makeRequest({ code: 'auth-code', state: 'forged-state' }),
        result.res,
    );

    assert.equal(result.statusCode, 400);
    assert.deepEqual(auth.calls, [
        { code: 'auth-code', state: 'forged-state' },
    ]);
    assert.equal(cron.triggered.length, 0);
});

test('authCallback passes a null state when the callback carries none', async () => {
    const auth = makeAuthService(() => {
        throw new Error(
            'Spotify authorization state does not match a pending authorization request',
        );
    });
    const cron = makeCronService();
    const controller = new SpotifyController(
        auth.service,
        cron.service,
        makeLogService(),
    );
    const result = makeResponse();

    await controller.authCallback(
        makeRequest({ code: 'auth-code' }),
        result.res,
    );

    assert.equal(result.statusCode, 400);
    assert.deepEqual(auth.calls, [{ code: 'auth-code', state: null }]);
    assert.equal(cron.triggered.length, 0);
});
