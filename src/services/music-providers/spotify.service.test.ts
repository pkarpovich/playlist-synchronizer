import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { Playlist, Track } from '../../entities.js';
import { LogService } from '../log.service.js';
import { SpotifyAuthService } from './spotify-auth.service.js';
import { DelayFn } from '../../utils/delay.js';
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
    unreadable?: boolean;
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

    isReady = false;

    token = 'access-1';

    failure: Error | null = null;

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
    unreadable = false,
}: StubbedResponse): SpotifyFetchResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
            if (unreadable) {
                throw new SyntaxError('Unexpected end of JSON input');
            }

            return body;
        },
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

test('getPlaylistTrackUris keeps every occurrence and applies the same skips', async () => {
    const harness = makeHarness([
        { status: 200, body: firstPage },
        { status: 200, body: secondPage },
    ]);

    const uris = await harness.service.getPlaylistTrackUris(playlist);

    assert.deepEqual(uris, [
        'spotify:track:1aaaaaaaaaaaaaaaaaaaaa',
        'spotify:track:2bbbbbbbbbbbbbbbbbbbbb',
        'spotify:track:1aaaaaaaaaaaaaaaaaaaaa',
        'spotify:track:3cccccccccccccccccccccc',
    ]);
});

test('a page body that cannot be parsed fails the read instead of truncating it', async () => {
    const harness = makeHarness([
        { status: 200, body: firstPage },
        { status: 200, unreadable: true },
    ]);

    await assert.rejects(
        () => harness.service.getPlaylistTrackUris(playlist),
        /unreadable playlist page/,
    );
});

test('a page without an items array fails the read instead of reporting an empty playlist', async () => {
    const harness = makeHarness([{ status: 200, body: {} }]);

    await assert.rejects(
        () => harness.service.getPlaylistTrackUris(playlist),
        /unreadable playlist page/,
    );
});

test('a page of track-keyed entries fails the read instead of reporting an empty playlist', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: {
                items: [
                    {
                        added_at: '2026-01-01T00:00:00Z',
                        track: {
                            uri: 'spotify:track:1aaaaaaaaaaaaaaaaaaaaa',
                            name: 'Song',
                            type: 'track',
                            artists: [{ name: 'Artist' }],
                        },
                    },
                ],
                next: null,
            },
        },
    ]);

    await assert.rejects(
        () => harness.service.getPlaylistTrackUris(playlist),
        /without an item field/,
    );
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

test('a 5xx retries with the 500/1000 delay sequence and then throws without a trailing sleep', async () => {
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
    assert.deepEqual(harness.delays, [500, 1000]);
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

test('a quoted title does not unbalance the field-filtered query', async () => {
    const harness = makeHarness([
        { status: 200, body: searchBody([]) },
        { status: 200, body: searchBody([]) },
    ]);

    await harness.service.resolveTrack({
        id: '1046',
        name: '"Heroes"',
        artists: ['David "Bowie"'],
    });

    assert.equal(
        queryOf(harness.calls[0]),
        'track:"Heroes" artist:"David Bowie"',
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

test('a search body that cannot be parsed fails the resolve instead of reporting no candidates', async () => {
    const harness = makeHarness([{ status: 200, unreadable: true }]);

    await assert.rejects(
        () => harness.service.resolveTrack(source),
        /unreadable search response/,
    );

    assert.equal(harness.calls.length, 1);
});

test('a search response without a tracks envelope means zero candidates', async () => {
    const harness = makeHarness([
        { status: 200, body: {} },
        { status: 200, body: {} },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.equal(resolved, null);
    assert.equal(harness.calls.length, 2);
});

test('malformed search candidates are skipped instead of failing the resolve', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                null,
                { uri: 'spotify:track:no-name', artists: [] },
                { uri: 'spotify:track:no-artists', name: 'тРи пОлОсКи' },
                {
                    uri: 'spotify:track:null-artist',
                    name: 'тРи пОлОсКи',
                    artists: [null],
                },
                skryptonite,
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack(source);

    assert.equal(resolved?.uri, 'spotify:track:tri-poloski');
    assert.equal(harness.calls.length, 1);
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

const MutationUrl =
    'https://api.spotify.com/v1/playlists/7qqAU3xa2efU4T06IvcY2W/items';

function makeUris(count: number): string[] {
    return Array.from(
        { length: count },
        (_, index) => `spotify:track:${index}`,
    );
}

function bodyOf({ init }: FetchCall): Record<string, unknown> {
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function snapshot(count: number): StubbedResponse[] {
    return Array.from({ length: count }, () => ({
        status: 200,
        body: { snapshot_id: 'snapshot-1' },
    }));
}

test('adding 250 URIs sends three chunked POST requests of 100/100/50', async () => {
    const harness = makeHarness(snapshot(3));
    const uris = makeUris(250);

    await harness.service.addTracksToPlaylist(uris, playlist);

    assert.equal(harness.calls.length, 3);
    assert.deepEqual(
        harness.calls.map((call) => (bodyOf(call).uris as string[]).length),
        [100, 100, 50],
    );
    assert.deepEqual(
        harness.calls.flatMap((call) => bodyOf(call).uris as string[]),
        uris,
    );

    for (const call of harness.calls) {
        const headers = call.init?.headers as Record<string, string>;

        assert.equal(call.url, MutationUrl);
        assert.equal(call.init?.method, 'POST');
        assert.equal(headers['Content-Type'], 'application/json');
        assert.equal(headers.Authorization, 'Bearer access-1');
    }
});

test('removing 250 URIs sends three chunked DELETE requests of 100/100/50', async () => {
    const harness = makeHarness(snapshot(3));
    const uris = makeUris(250);

    await harness.service.removeTracksFromPlaylist(uris, playlist);

    assert.equal(harness.calls.length, 3);
    assert.deepEqual(
        harness.calls.map((call) => (bodyOf(call).items as unknown[]).length),
        [100, 100, 50],
    );

    for (const call of harness.calls) {
        assert.equal(call.url, MutationUrl);
        assert.equal(call.init?.method, 'DELETE');
    }
});

test('the removal body uses the items key and not tracks', async () => {
    const harness = makeHarness(snapshot(1));

    await harness.service.removeTracksFromPlaylist(
        ['spotify:track:gone'],
        playlist,
    );

    const body = bodyOf(harness.calls[0]);

    assert.equal(body.tracks, undefined);
    assert.deepEqual(body, { items: [{ uri: 'spotify:track:gone' }] });
});

test('empty add and remove lists issue zero requests', async () => {
    const harness = makeHarness([]);

    await harness.service.addTracksToPlaylist([], playlist);
    await harness.service.removeTracksFromPlaylist([], playlist);

    assert.equal(harness.calls.length, 0);
    assert.deepEqual(harness.delays, []);
});

test('a chunk that fails with a 5xx retries and does not skip the rest', async () => {
    const harness = makeHarness([
        ...snapshot(1),
        { status: 500, body: {} },
        ...snapshot(2),
    ]);

    await harness.service.addTracksToPlaylist(makeUris(250), playlist);

    assert.equal(harness.calls.length, 4);
    assert.deepEqual(harness.delays, [500]);
    assert.deepEqual(
        harness.calls.map((call) => (bodyOf(call).uris as string[]).length),
        [100, 100, 100, 50],
    );
});

function spotifyTrack(
    uri: string,
    name: string,
    durationMs: number,
    artists: string[] = ['Skryptonite'],
): unknown {
    return {
        uri,
        name,
        type: 'track',
        duration_ms: durationMs,
        artists: artists.map((artist) => ({ name: artist })),
        external_ids: { isrc: 'QZES71982314' },
    };
}

test('resolveTrack prefers the closest duration over the search ranking', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                spotifyTrack('spotify:track:rmx', 'Всё просто (RMX)', 185_142, [
                    'Antoha MC',
                ]),
                spotifyTrack('spotify:track:original', 'Всё просто', 201_857, [
                    'Antoha MC',
                ]),
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '1',
        name: 'Всё просто',
        artists: ['Антоха МС'],
        durationMs: 201_850,
    });

    assert.equal(resolved?.uri, 'spotify:track:original');
    assert.equal(harness.calls.length, 1);
});

test('resolveTrack separates two masters that share a title', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                spotifyTrack('spotify:track:other', 'Танцы на снегу', 185_941, [
                    'Husky',
                ]),
                spotifyTrack('spotify:track:exact', 'Танцы на снегу', 183_765, [
                    'Husky',
                ]),
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '2',
        name: 'Танцы на снегу',
        artists: ['Хаски'],
        durationMs: 183_760,
    });

    assert.equal(resolved?.uri, 'spotify:track:exact');
});

test('resolveTrack matches a source version against a decorated Spotify title', async () => {
    const harness = makeHarness([
        {
            status: 200,
            body: searchBody([
                spotifyTrack(
                    'spotify:track:pyatna',
                    'Пятна - from "Арлан. Решающий раунд"',
                    182_769,
                    ['Truwer'],
                ),
            ]),
        },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '3',
        name: 'Пятна',
        version: 'from "Арлан. Решающий раунд"',
        artists: ['Truwer'],
        durationMs: 182_760,
    });

    assert.equal(resolved?.uri, 'spotify:track:pyatna');
});

test('resolveTrack falls back to a renamed track confirmed by duration', async () => {
    const miami = spotifyTrack('spotify:track:miami96', 'Miami 96', 121_919, [
        'BORIS REDWALL',
        'AQYLA',
    ]);
    const harness = makeHarness([
        { status: 200, body: searchBody([miami]) },
        { status: 200, body: searchBody([miami]) },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '4',
        name: 'Miami',
        artists: ['BORIS REDWALL', 'AQYLA'],
        durationMs: 121_910,
    });

    assert.equal(resolved?.uri, 'spotify:track:miami96');
    assert.equal(harness.calls.length, 2);
    assert.ok(harness.logs.some((entry) => entry.includes('renamed')));
});

test('resolveTrack falls back through a censored source title', async () => {
    const track = spotifyTrack('spotify:track:tpx', 'так похуй', 108_000, [
        'madk1d',
    ]);
    const harness = makeHarness([
        { status: 200, body: searchBody([track]) },
        { status: 200, body: searchBody([track]) },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '5',
        name: 'так по***',
        artists: ['madk1d'],
        durationMs: 108_000,
    });

    assert.equal(resolved?.uri, 'spotify:track:tpx');
});

test('the renamed fallback refuses a duration further than one second away', async () => {
    const sequel = spotifyTrack('spotify:track:miura2', 'Miura 2', 87_972, [
        'Skryptonite',
    ]);
    const harness = makeHarness([
        { status: 200, body: searchBody([sequel]) },
        { status: 200, body: searchBody([sequel]) },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '6',
        name: 'Miura',
        artists: ['Skryptonite'],
        durationMs: 104_140,
    });

    assert.equal(resolved, null);
});

test('the renamed fallback requires an overlapping artist', async () => {
    const other = spotifyTrack('spotify:track:foreign', 'Miami 96', 121_919, [
        'Someone Else',
    ]);
    const harness = makeHarness([
        { status: 200, body: searchBody([other]) },
        { status: 200, body: searchBody([other]) },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '7',
        name: 'Miami',
        artists: ['BORIS REDWALL'],
        durationMs: 121_910,
    });

    assert.equal(resolved, null);
});

test('the renamed fallback stays off when the source carries no duration', async () => {
    const miami = spotifyTrack('spotify:track:miami96', 'Miami 96', 121_919, [
        'BORIS REDWALL',
    ]);
    const harness = makeHarness([
        { status: 200, body: searchBody([miami]) },
        { status: 200, body: searchBody([miami]) },
    ]);

    const resolved = await harness.service.resolveTrack({
        id: '8',
        name: 'Miami',
        artists: ['BORIS REDWALL'],
    });

    assert.equal(resolved, null);
});
