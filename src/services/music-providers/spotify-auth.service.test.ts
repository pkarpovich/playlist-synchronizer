import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { IConfig } from '../../config.js';
import { ConfigService } from '../config.service.js';
import { DbService } from '../db.service.js';
import { LogService } from '../log.service.js';
import { SpotifyAuthService, DelayFn } from './spotify-auth.service.js';
import { SpotifyNotAuthorizedError } from './spotify-errors.js';
import { SpotifyFetchFn, SpotifyFetchResponse } from './spotify-types.js';

const AuthServiceName = 'spotify';
const AuthorizeUrl = 'https://accounts.spotify.com/authorize';

interface LogEntry {
    level: string;
    message: string;
}

interface FetchCall {
    url: string;
    init?: RequestInit;
}

interface StubbedResponse {
    status: number;
    body: unknown;
}

interface Harness {
    authService: SpotifyAuthService;
    dbService: DbService;
    logs: LogEntry[];
    calls: FetchCall[];
    delays: number[];
    setNow: (value: number) => void;
}

function makeLogStub(logs: LogEntry[]): LogService {
    const push = (level: string) => (message: string | Error) =>
        logs.push({ level, message: String(message) });

    return {
        createScope: () => ({}),
        info: push('info'),
        warn: push('warn'),
        success: push('success'),
        error: push('error'),
        await: push('await'),
    } as unknown as LogService;
}

function makeResponse({ status, body }: StubbedResponse): SpotifyFetchResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: { get: () => null },
    };
}

function makeHarness(
    responses: (StubbedResponse | Error)[],
    startNow = 1000,
): Harness {
    const logs: LogEntry[] = [];
    const calls: FetchCall[] = [];
    const delays: number[] = [];
    let current = startNow;

    const dbService = new DbService(
        new ConfigService<IConfig>({ dbPath: ':memory:' } as IConfig),
        makeLogStub([]),
    );

    const fetchFn: SpotifyFetchFn = async (url, init) => {
        calls.push({ url, init });

        const next = responses.shift();
        if (!next) {
            throw new Error('unexpected fetch call');
        }

        if (next instanceof Error) {
            throw next;
        }

        return makeResponse(next);
    };

    const delayFn: DelayFn = async (ms) => {
        delays.push(ms);
    };

    const configService = new ConfigService<IConfig>({
        spotify: {
            clientId: 'client-1',
            clientSecret: 'secret-1',
            redirectUri: 'https://sync.example/spotify/callback',
        },
    } as IConfig);

    const authService = new SpotifyAuthService(
        dbService,
        configService,
        makeLogStub(logs),
        fetchFn,
        () => current,
        delayFn,
    );

    return {
        authService,
        dbService,
        logs,
        calls,
        delays,
        setNow: (value: number) => {
            current = value;
        },
    };
}

function accessTokenResponse(
    accessToken: string,
    refreshToken?: string,
): StubbedResponse {
    return {
        status: 200,
        body: {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
        },
    };
}

test('initialize refreshes a stored token and becomes authorized', async () => {
    const harness = makeHarness([accessTokenResponse('access-1')]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    assert.equal(harness.authService.state, 'authorized');
    assert.equal(harness.authService.isReady, true);
    assert.equal(harness.calls.length, 1);
    assert.equal(
        harness.calls[0].url,
        'https://accounts.spotify.com/api/token',
    );
    assert.deepEqual(harness.delays, []);
    assert.equal(await harness.authService.getAccessToken(), 'access-1');
});

test('the refresh request carries basic auth and the form-encoded grant', async () => {
    const harness = makeHarness([accessTokenResponse('access-1')]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    const { init } = harness.calls[0];
    const headers = init?.headers as Record<string, string>;

    assert.equal(init?.method, 'POST');
    assert.equal(
        headers.Authorization,
        `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`,
    );
    assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(
        init?.body,
        'grant_type=refresh_token&refresh_token=refresh-1',
    );
});

test('a rotated refresh token is persisted before the access token is used', async () => {
    const harness = makeHarness([accessTokenResponse('access-1', 'refresh-2')]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    const originalSetRefreshToken = harness.dbService.setRefreshToken.bind(
        harness.dbService,
    );
    const statesAtWrite: string[] = [];
    harness.dbService.setRefreshToken = (service, token) => {
        statesAtWrite.push(harness.authService.state);
        originalSetRefreshToken(service, token);
    };

    await harness.authService.initialize();

    assert.deepEqual(statesAtWrite, ['not-authorized']);
    assert.equal(
        harness.dbService.getAuth(AuthServiceName)?.refreshToken,
        'refresh-2',
    );
    assert.equal(harness.authService.state, 'authorized');
});

test('initialize resolves on invalid_grant, discards the token and logs the authorize URL', async () => {
    const harness = makeHarness([
        { status: 400, body: { error: 'invalid_grant' } },
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');
    harness.setNow(1700000000000);

    await assert.doesNotReject(() => harness.authService.initialize());

    assert.equal(harness.authService.state, 'needs-reauthorization');
    assert.equal(harness.authService.isReady, false);
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.delays, []);

    const record = harness.dbService.getAuth(AuthServiceName);
    assert.equal(record?.refreshToken, '');
    assert.equal(record?.revokedAt, 1700000000000);

    assert.ok(
        harness.logs.some(({ message }) =>
            message.includes('accounts.spotify.com/authorize'),
        ),
    );
});

test('invalid_client leaves the stored token untouched', async () => {
    const harness = makeHarness([
        { status: 400, body: { error: 'invalid_client' } },
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    const record = harness.dbService.getAuth(AuthServiceName);
    assert.equal(record?.refreshToken, 'refresh-1');
    assert.equal(record?.revokedAt, null);
    assert.equal(harness.authService.state, 'not-authorized');
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.delays, []);
});

test('a 5xx response retries with the 500/1000/2000 delay sequence', async () => {
    const harness = makeHarness([
        { status: 500, body: {} },
        { status: 502, body: {} },
        { status: 503, body: {} },
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    assert.equal(harness.calls.length, 3);
    assert.deepEqual(harness.delays, [500, 1000, 2000]);
    assert.equal(harness.authService.state, 'not-authorized');
    assert.equal(harness.dbService.getAuth(AuthServiceName)?.revokedAt, null);
});

test('a 429 response retries with the 500/1000/2000 delay sequence', async () => {
    const harness = makeHarness([
        { status: 429, body: {} },
        { status: 429, body: {} },
        { status: 429, body: {} },
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    assert.equal(harness.calls.length, 3);
    assert.deepEqual(harness.delays, [500, 1000, 2000]);
    assert.equal(harness.authService.state, 'not-authorized');
});

test('a thrown fetch error is treated as transient', async () => {
    const harness = makeHarness([
        new Error('socket hang up'),
        new Error('socket hang up'),
        { status: 200, body: { access_token: 'access-1', expires_in: 3600 } },
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    assert.deepEqual(harness.delays, [500, 1000]);
    assert.equal(harness.authService.state, 'authorized');
});

test('a transient failure leaves the next getAccessToken free to retry', async () => {
    const harness = makeHarness([
        { status: 500, body: {} },
        { status: 500, body: {} },
        { status: 500, body: {} },
        accessTokenResponse('access-1'),
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();
    assert.equal(harness.authService.state, 'not-authorized');
    assert.equal(harness.authService.isReady, true);

    assert.equal(await harness.authService.getAccessToken(), 'access-1');
    assert.equal(harness.authService.state, 'authorized');
});

test('a stored refresh token is required for readiness before the first success', async () => {
    const harness = makeHarness([]);

    await harness.authService.initialize();

    assert.equal(harness.authService.state, 'not-authorized');
    assert.equal(harness.authService.isReady, false);
});

test('an empty token with revoked_at needs reauthorization without any fetch', async () => {
    const harness = makeHarness([]);
    harness.dbService.setRevokedAt(AuthServiceName, 1700000000000);

    await harness.authService.initialize();

    assert.equal(harness.authService.state, 'needs-reauthorization');
    assert.equal(harness.calls.length, 0);
    assert.ok(
        harness.logs.some(({ message }) =>
            message.includes('accounts.spotify.com/authorize'),
        ),
    );
});

test('an empty token without revoked_at stays not-authorized without any fetch', async () => {
    const harness = makeHarness([]);

    await harness.authService.initialize();

    assert.equal(harness.authService.state, 'not-authorized');
    assert.equal(harness.calls.length, 0);
    assert.ok(
        harness.logs.some(({ message }) =>
            message.includes('accounts.spotify.com/authorize'),
        ),
    );
});

test('getAccessToken rejects once authorization was revoked', async () => {
    const harness = makeHarness([
        { status: 400, body: { error: 'invalid_grant' } },
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    await assert.rejects(
        () => harness.authService.getAccessToken(),
        SpotifyNotAuthorizedError,
    );
    assert.equal(harness.calls.length, 1);
});

test('getAccessToken rejects when no refresh token was ever stored', async () => {
    const harness = makeHarness([]);

    await assert.rejects(
        () => harness.authService.getAccessToken(),
        SpotifyNotAuthorizedError,
    );
    assert.equal(harness.calls.length, 0);
});

test('a cached access token is reused until the 60 second margin', async () => {
    const harness = makeHarness([
        accessTokenResponse('access-1'),
        accessTokenResponse('access-2'),
    ]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    assert.equal(await harness.authService.getAccessToken(), 'access-1');

    harness.setNow(1000 + 3600000 - 60000 - 1);
    assert.equal(await harness.authService.getAccessToken(), 'access-1');
    assert.equal(harness.calls.length, 1);

    harness.setNow(1000 + 3600000 - 60000);
    assert.equal(await harness.authService.getAccessToken(), 'access-2');
    assert.equal(harness.calls.length, 2);
});

test('concurrent getAccessToken calls share a single refresh', async () => {
    const harness = makeHarness([accessTokenResponse('access-1')]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    const tokens = await Promise.all([
        harness.authService.getAccessToken(),
        harness.authService.getAccessToken(),
        harness.authService.getAccessToken(),
    ]);

    assert.deepEqual(tokens, ['access-1', 'access-1', 'access-1']);
    assert.equal(harness.calls.length, 1);
});

function readState(authorizeUrl: string): string {
    return new URL(authorizeUrl).searchParams.get('state') ?? '';
}

test('the authorize URL carries the documented parameters and a stored state', () => {
    const harness = makeHarness([]);

    const url = new URL(harness.authService.buildAuthorizeUrl());
    const params = url.searchParams;

    assert.equal(`${url.origin}${url.pathname}`, AuthorizeUrl);
    assert.equal(params.get('client_id'), 'client-1');
    assert.equal(params.get('response_type'), 'code');
    assert.equal(
        params.get('redirect_uri'),
        'https://sync.example/spotify/callback',
    );
    assert.equal(
        params.get('scope'),
        'playlist-read-private playlist-modify-private playlist-modify-public',
    );
    assert.equal(
        harness.dbService.getAuth(AuthServiceName)?.pendingState,
        params.get('state'),
    );
    assert.equal(harness.calls.length, 0);
});

test('two authorize URLs carry different state values', () => {
    const harness = makeHarness([]);

    const first = readState(harness.authService.buildAuthorizeUrl());
    const second = readState(harness.authService.buildAuthorizeUrl());

    assert.notEqual(first, second);
    assert.ok(first.length > 0);
    assert.equal(
        harness.dbService.getAuth(AuthServiceName)?.pendingState,
        second,
    );
});

test('the matching state exchanges the code and clears the revoked marker', async () => {
    const harness = makeHarness([accessTokenResponse('access-1', 'refresh-2')]);
    harness.dbService.setRevokedAt(AuthServiceName, 1700000000000);

    const state = readState(harness.authService.buildAuthorizeUrl());
    await harness.authService.exchangeCode('code-1', state);

    assert.equal(harness.authService.state, 'authorized');
    assert.equal(harness.authService.isReady, true);

    const record = harness.dbService.getAuth(AuthServiceName);
    assert.equal(record?.refreshToken, 'refresh-2');
    assert.equal(record?.revokedAt, null);
    assert.equal(record?.pendingState, null);

    const { init } = harness.calls[0];
    assert.equal(init?.method, 'POST');
    assert.equal(
        init?.body,
        'grant_type=authorization_code&code=code-1&redirect_uri=https%3A%2F%2Fsync.example%2Fspotify%2Fcallback',
    );
    assert.equal(await harness.authService.getAccessToken(), 'access-1');
});

test('a mismatched state is rejected without any fetch call', async () => {
    const harness = makeHarness([]);
    harness.authService.buildAuthorizeUrl();

    await assert.rejects(() =>
        harness.authService.exchangeCode('code-1', 'not-the-state'),
    );

    assert.equal(harness.calls.length, 0);
    assert.equal(harness.authService.state, 'not-authorized');
});

test('a missing state is rejected without any fetch call', async () => {
    const harness = makeHarness([]);
    harness.authService.buildAuthorizeUrl();

    await assert.rejects(() =>
        harness.authService.exchangeCode('code-1', null),
    );

    assert.equal(harness.calls.length, 0);
    assert.equal(harness.authService.state, 'not-authorized');
});

test('an exchange without a pending state is rejected without any fetch call', async () => {
    const harness = makeHarness([]);

    await assert.rejects(() =>
        harness.authService.exchangeCode('code-1', 'some-state'),
    );

    assert.equal(harness.calls.length, 0);
});

test('a reused state is rejected after the first exchange consumed it', async () => {
    const harness = makeHarness([accessTokenResponse('access-1', 'refresh-2')]);

    const state = readState(harness.authService.buildAuthorizeUrl());
    await harness.authService.exchangeCode('code-1', state);

    await assert.rejects(() =>
        harness.authService.exchangeCode('code-2', state),
    );

    assert.equal(harness.calls.length, 1);
    assert.equal(
        harness.dbService.getAuth(AuthServiceName)?.refreshToken,
        'refresh-2',
    );
});

test('a success without an access token is not retried', async () => {
    const harness = makeHarness([{ status: 200, body: { expires_in: 3600 } }]);
    harness.dbService.setRefreshToken(AuthServiceName, 'refresh-1');

    await harness.authService.initialize();

    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.delays, []);
    assert.equal(harness.authService.state, 'not-authorized');
});
