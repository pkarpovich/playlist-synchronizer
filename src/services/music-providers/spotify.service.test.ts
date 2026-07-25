import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { Playlist, Track } from '../../entities.js';
import { LogService } from '../log.service.js';
import { DelayFn, SpotifyAuthService } from './spotify-auth.service.js';
import {
    SpotifyHttpError,
    SpotifyNotAuthorizedError,
} from './spotify-errors.js';
import { SpotifyFetchFn, SpotifyFetchResponse } from './spotify-types.js';
import { SpotifyService } from './spotify.service.js';

const fixture = JSON.parse(
    readFileSync(
        new URL('./__fixtures__/spotify-playlist-items.json', import.meta.url),
        'utf-8',
    ),
) as unknown[];

const [firstPage, secondPage] = fixture;

const playlist: Playlist = {
    id: '7qqAU3xa2efU4T06IvcY2W',
    userName: 'sync-user',
    name: 'Target playlist',
};

const FirstPageUrl =
    'https://api.spotify.com/v1/playlists/7qqAU3xa2efU4T06IvcY2W/items?limit=50&offset=0';
const SecondPageUrl =
    'https://api.spotify.com/v1/playlists/7qqAU3xa2efU4T06IvcY2W/items?offset=50&limit=50';

interface FetchCall {
    url: string;
    init?: RequestInit;
}

interface StubbedResponse {
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
}

interface Harness {
    service: SpotifyService;
    auth: AuthServiceStub;
    calls: FetchCall[];
    delays: number[];
    logs: string[];
}

class AuthServiceStub {
    refreshCalls = 0;

    initializeCalls = 0;

    exchangeCalls: { code: string; state: string | null }[] = [];

    isReady = false;

    token = 'access-1';

    failure: Error | null = null;

    async initialize(): Promise<void> {
        this.initializeCalls += 1;
    }

    async exchangeCode(code: string, state: string | null): Promise<void> {
        this.exchangeCalls.push({ code, state });
    }

    async getAccessToken(): Promise<string> {
        if (this.failure) {
            throw this.failure;
        }

        return this.token;
    }

    async refreshAccessToken(): Promise<string> {
        this.refreshCalls += 1;
        this.token = `access-${this.refreshCalls + 1}`;

        return this.token;
    }
}

function makeLogStub(logs: string[]): LogService {
    const push = (message: string | Error) => logs.push(String(message));

    return {
        createScope: () => ({}),
        info: push,
        warn: push,
        success: push,
        error: push,
        await: push,
    } as unknown as LogService;
}

function makeResponse({
    status,
    body,
    headers = {},
}: StubbedResponse): SpotifyFetchResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: { get: (name: string) => headers[name] ?? null },
    };
}

function makeHarness(responses: (StubbedResponse | Error)[]): Harness {
    const calls: FetchCall[] = [];
    const delays: number[] = [];
    const logs: string[] = [];
    const auth = new AuthServiceStub();

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

    const service = new SpotifyService(
        auth as unknown as SpotifyAuthService,
        makeLogStub(logs),
        fetchFn,
        delayFn,
    );

    return { service, auth, calls, delays, logs };
}

test('getPlaylistTracks follows next and collects both pages', async () => {
    const harness = makeHarness([
        { status: 200, body: firstPage },
        { status: 200, body: secondPage },
    ]);

    const tracks = await harness.service.getPlaylistTracks(playlist);

    assert.equal(harness.calls.length, 2);
    assert.equal(harness.calls[0].url, FirstPageUrl);
    assert.equal(harness.calls[1].url, SecondPageUrl);
    assert.deepEqual(
        tracks.map(({ name }) => name),
        ['Быть богатым', 'тРи пОлОсКи', "(Don't Fear) The Reaper"],
    );
    assert.deepEqual(tracks[0].artists, ['Скриптонит']);
    assert.deepEqual(harness.delays, []);
});

test('a null item, a non-track item and a local file are skipped', async () => {
    const harness = makeHarness([
        { status: 200, body: firstPage },
        { status: 200, body: secondPage },
    ]);

    const tracks = await harness.service.getPlaylistTracks(playlist);
    const ids = tracks.map(({ id }) => id);

    assert.equal(tracks.length, 3);
    assert.ok(!ids.some((id) => id?.startsWith('spotify:episode:')));
    assert.ok(!ids.some((id) => id?.startsWith('spotify:local:')));
    assert.ok(tracks.every((track) => Boolean(track.id)));
});

test('a URI repeated across pages is returned once', async () => {
    const harness = makeHarness([
        { status: 200, body: firstPage },
        { status: 200, body: secondPage },
    ]);

    const tracks = await harness.service.getPlaylistTracks(playlist);
    const ids = tracks.map(({ id }) => id);

    assert.equal(new Set(ids).size, ids.length);
});

test('reading a playlist issues only GET requests with a bearer token', async () => {
    const harness = makeHarness([
        { status: 200, body: firstPage },
        { status: 200, body: secondPage },
    ]);

    await harness.service.getPlaylistTracks(playlist);

    for (const { init } of harness.calls) {
        const headers = init?.headers as Record<string, string>;

        assert.ok(!init?.method || init.method === 'GET');
        assert.equal(init?.body, undefined);
        assert.equal(headers.Authorization, 'Bearer access-1');
        assert.equal(headers['Content-Type'], undefined);
    }
});

test('a 401 triggers exactly one refresh and one retry', async () => {
    const harness = makeHarness([
        { status: 401, body: { error: { status: 401 } } },
        { status: 200, body: secondPage },
    ]);

    const tracks = await harness.service.getPlaylistTracks(playlist);

    assert.equal(harness.auth.refreshCalls, 1);
    assert.equal(harness.calls.length, 2);
    assert.deepEqual(harness.delays, []);
    assert.equal(tracks.length, 3);

    const retryHeaders = harness.calls[1].init?.headers as Record<
        string,
        string
    >;
    assert.equal(retryHeaders.Authorization, 'Bearer access-2');
});

test('a second 401 for the same call throws without another refresh', async () => {
    const harness = makeHarness([
        { status: 401, body: {} },
        { status: 401, body: {} },
    ]);

    await assert.rejects(
        () => harness.service.getPlaylistTracks(playlist),
        SpotifyHttpError,
    );

    assert.equal(harness.auth.refreshCalls, 1);
    assert.equal(harness.calls.length, 2);
    assert.deepEqual(harness.delays, []);
});

test('a 403 throws immediately without a refresh or a retry', async () => {
    const harness = makeHarness([{ status: 403, body: {} }]);

    await assert.rejects(
        () => harness.service.getPlaylistTracks(playlist),
        (error: unknown) =>
            error instanceof SpotifyHttpError && error.status === 403,
    );

    assert.equal(harness.auth.refreshCalls, 0);
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.delays, []);
});

test('a 404 throws immediately without a retry', async () => {
    const harness = makeHarness([{ status: 404, body: {} }]);

    await assert.rejects(
        () => harness.service.getPlaylistTracks(playlist),
        (error: unknown) =>
            error instanceof SpotifyHttpError && error.status === 404,
    );

    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.delays, []);
});

test('a 429 waits the parsed Retry-After before retrying', async () => {
    const harness = makeHarness([
        { status: 429, body: {}, headers: { 'retry-after': '2' } },
        { status: 200, body: secondPage },
    ]);

    await harness.service.getPlaylistTracks(playlist);

    assert.deepEqual(harness.delays, [2000]);
    assert.equal(harness.calls.length, 2);
});

test('a 429 without a usable Retry-After falls back to one second', async () => {
    const harness = makeHarness([
        { status: 429, body: {} },
        { status: 200, body: secondPage },
    ]);

    await harness.service.getPlaylistTracks(playlist);

    assert.deepEqual(harness.delays, [1000]);
});

test('a 5xx retries with the 500/1000/2000 delay sequence and then throws', async () => {
    const harness = makeHarness([
        { status: 500, body: {} },
        { status: 502, body: {} },
        { status: 503, body: {} },
    ]);

    await assert.rejects(
        () => harness.service.getPlaylistTracks(playlist),
        SpotifyHttpError,
    );

    assert.equal(harness.calls.length, 3);
    assert.deepEqual(harness.delays, [500, 1000, 2000]);
});

test('a thrown fetch error is retried with the backoff sequence', async () => {
    const harness = makeHarness([
        new Error('socket hang up'),
        new Error('socket hang up'),
        { status: 200, body: secondPage },
    ]);

    const tracks = await harness.service.getPlaylistTracks(playlist);

    assert.deepEqual(harness.delays, [500, 1000]);
    assert.equal(tracks.length, 3);
});

test('an unauthorized auth service aborts before any request', async () => {
    const harness = makeHarness([{ status: 200, body: secondPage }]);
    harness.auth.failure = new SpotifyNotAuthorizedError('revoked');

    await assert.rejects(
        () => harness.service.getPlaylistTracks(playlist),
        SpotifyNotAuthorizedError,
    );

    assert.equal(harness.calls.length, 0);
    assert.deepEqual(harness.delays, []);
});

test('isReady follows the auth service readiness', () => {
    const harness = makeHarness([]);

    assert.equal(harness.service.isReady, false);

    harness.auth.isReady = true;
    assert.equal(harness.service.isReady, true);
});

function searchBody(items: unknown[]): unknown {
    return { tracks: { items } };
}

function queryOf({ url }: FetchCall): string {
    return new URL(url).searchParams.get('q') ?? '';
}

function assertSearchCall(call: FetchCall): void {
    const { searchParams, origin, pathname } = new URL(call.url);

    assert.equal(origin + pathname, 'https://api.spotify.com/v1/search');
    assert.equal(searchParams.get('type'), 'track');
    assert.equal(searchParams.get('limit'), '10');
    assert.ok(!call.init?.method || call.init.method === 'GET');
    assert.equal(call.init?.body, undefined);
}

const skryptonite = {
    uri: 'spotify:track:tri-poloski',
    name: 'тРи пОлОсКи',
    type: 'track',
    duration_ms: 214_000,
    artists: [{ name: 'Skryptonite' }],
    external_ids: { isrc: 'QZES71982314' },
};

const source: Track = {
    id: '1045',
    name: 'тРи пОлОсКи',
    artists: ['Скриптонит', 'Райда'],
};

test('resolveTrack sends the field-filtered query with limit 10', async () => {
    const harness = makeHarness([
        { status: 200, body: searchBody([skryptonite]) },
    ]);

    await harness.service.resolveTrack(source);

    assert.equal(harness.calls.length, 1);
    assertSearchCall(harness.calls[0]);
    assert.equal(
        queryOf(harness.calls[0]),
        'track:"тРи пОлОсКи" artist:"Скриптонит"',
    );
});

test('step one accepts a candidate whose artists do not overlap the source', async () => {
    const harness = makeHarness([
        { status: 200, body: searchBody([skryptonite]) },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.deepEqual(resolved, {
        uri: 'spotify:track:tri-poloski',
        isrc: 'QZES71982314',
        durationMs: 214_000,
    });
    assert.equal(harness.calls.length, 1);
});

test('step two rejects the same candidate because its artists do not overlap', async () => {
    const harness = makeHarness([
        { status: 200, body: searchBody([]) },
        { status: 200, body: searchBody([skryptonite]) },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.equal(resolved, null);
    assert.equal(harness.calls.length, 2);
    assert.equal(queryOf(harness.calls[1]), 'тРи пОлОсКи Скриптонит');
});

test('an empty step one result triggers the free-text search', async () => {
    const harness = makeHarness([
        { status: 200, body: searchBody([]) },
        {
            status: 200,
            body: searchBody([
                {
                    uri: 'spotify:track:other',
                    name: 'Another song',
                    artists: [{ name: 'Скриптонит' }],
                },
                {
                    uri: 'spotify:track:tri-poloski',
                    name: 'тРи пОлОсКи',
                    artists: [{ name: 'Райда' }],
                },
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.deepEqual(resolved, {
        uri: 'spotify:track:tri-poloski',
        isrc: null,
        durationMs: null,
    });
    assert.equal(harness.calls.length, 2);
    assertSearchCall(harness.calls[1]);
});

test('a missing tracks envelope is treated as zero candidates', async () => {
    const harness = makeHarness([
        { status: 200, body: {} },
        { status: 200, body: {} },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.equal(resolved, null);
    assert.equal(harness.calls.length, 2);
});

test('step one accepts the first candidate whose title matches', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                {
                    uri: 'spotify:track:wrong',
                    name: 'тРи пОлОсКи - Part 2',
                    artists: [{ name: 'Skryptonite' }],
                },
                skryptonite,
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.equal(resolved?.uri, 'spotify:track:tri-poloski');
});

test('when nothing matches the result is null and no mutation request follows', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                {
                    uri: 'spotify:track:wrong',
                    name: 'A different song',
                    artists: [{ name: 'Skryptonite' }],
                },
            ]),
        },
        {
            status: 200,
            body: searchBody([
                {
                    uri: 'spotify:track:wrong',
                    name: 'A different song',
                    artists: [{ name: 'Скриптонит' }],
                },
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.equal(resolved, null);
    assert.equal(harness.calls.length, 2);
    harness.calls.forEach(assertSearchCall);
});

test('artist objects without followers or popularity resolve without throwing', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                {
                    uri: 'spotify:track:tri-poloski',
                    name: 'тРи пОлОсКи',
                    type: 'track',
                    artists: [{ name: 'Skryptonite' }],
                },
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.deepEqual(resolved, {
        uri: 'spotify:track:tri-poloski',
        isrc: null,
        durationMs: null,
    });
});

test('the interim shims delegate to the auth service', async () => {
    const harness = makeHarness([]);

    await harness.service.initializeClient();
    await harness.service.authorizationCodeGrant('code-1', 'state-1');

    assert.equal(harness.auth.initializeCalls, 1);
    assert.deepEqual(harness.auth.exchangeCalls, [
        { code: 'code-1', state: 'state-1' },
    ]);
    assert.equal(harness.calls.length, 0);
});
