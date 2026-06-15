import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { socksDispatcher } from 'fetch-socks';

import { IConfig } from '../../config.js';
import { Playlist } from '../../entities.js';
import { ConfigService } from '../config.service.js';
import { LogService } from '../log.service.js';
import { FetchFn, YandexMusicService } from './yandex-music.service.js';
import {
    parseSocksProxy,
    YandexPlaylistResponse,
} from './yandex-music.helpers.js';

const fixture = JSON.parse(
    readFileSync(
        new URL('./__fixtures__/yandex-playlist.json', import.meta.url),
        'utf-8',
    ),
) as YandexPlaylistResponse;

const playlist: Playlist = {
    id: '1054',
    userName: 'flomaster-mc',
    name: 'Test playlist',
};

const logStub = {} as LogService;

function makeConfig(proxyUrl = ''): ConfigService<IConfig> {
    return new ConfigService<IConfig>({
        yandexMusic: { baseUrl: 'https://api.music.yandex.net', proxyUrl },
    } as IConfig);
}

function makeService(fetchFn: FetchFn, proxyUrl = ''): YandexMusicService {
    return new YandexMusicService(logStub, makeConfig(proxyUrl), fetchFn);
}

test('getPlaylistTracks maps a 200 response into tracks', async () => {
    const fetchFn: FetchFn = async () => ({
        ok: true,
        status: 200,
        json: async () => fixture,
    });

    const tracks = await makeService(fetchFn).getPlaylistTracks(playlist);

    assert.equal(tracks.length, 3);
    assert.deepEqual(
        tracks.map(({ name }) => name),
        ['Smells Like Teen Spirit', 'Numb / Encore', 'Bohemian Rhapsody'],
    );
    assert.deepEqual(tracks[1].artists, ['Linkin Park', 'Jay-Z']);
});

test('getPlaylistTracks requests the official playlist endpoint', async () => {
    let capturedUrl = '';
    const fetchFn: FetchFn = async (url) => {
        capturedUrl = url;
        return { ok: true, status: 200, json: async () => fixture };
    };

    await makeService(fetchFn).getPlaylistTracks(playlist);

    assert.equal(
        capturedUrl,
        'https://api.music.yandex.net/users/flomaster-mc/playlists/1054',
    );
});

test('getPlaylistTracks returns [] for an empty playlist', async () => {
    const fetchFn: FetchFn = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ result: { tracks: [] } }),
    });

    const tracks = await makeService(fetchFn).getPlaylistTracks(playlist);

    assert.deepEqual(tracks, []);
});

test('getPlaylistTracks throws on a 404 response', async () => {
    const fetchFn: FetchFn = async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
    });

    await assert.rejects(
        () => makeService(fetchFn).getPlaylistTracks(playlist),
        /HTTP 404/,
    );
});

test('getPlaylistTracks throws on a 451 geo-block response', async () => {
    const fetchFn: FetchFn = async () => ({
        ok: false,
        status: 451,
        json: async () => ({}),
    });

    await assert.rejects(
        () => makeService(fetchFn).getPlaylistTracks(playlist),
        /HTTP 451/,
    );
});

test('getPlaylistTracks propagates a rejected fetch', async () => {
    const fetchFn: FetchFn = async () => {
        throw new Error('network down');
    };

    await assert.rejects(
        () => makeService(fetchFn).getPlaylistTracks(playlist),
        /network down/,
    );
});

test('getPlaylistTracks routes through a socks dispatcher when a proxy is set', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn: FetchFn = async (_url, init) => {
        capturedInit = init;
        return { ok: true, status: 200, json: async () => fixture };
    };

    await makeService(fetchFn, 'socks5h://127.0.0.1:1080').getPlaylistTracks(
        playlist,
    );

    assert.ok(capturedInit?.dispatcher);
});

test('getPlaylistTracks fetches directly when no proxy is set', async () => {
    let capturedInit: RequestInit | undefined = {} as RequestInit;
    const fetchFn: FetchFn = async (_url, init) => {
        capturedInit = init;
        return { ok: true, status: 200, json: async () => fixture };
    };

    await makeService(fetchFn).getPlaylistTracks(playlist);

    assert.equal(capturedInit, undefined);
});

test('socksDispatcher is compatible with the runtime fetch (guards undici version skew)', async () => {
    const dispatcher = socksDispatcher(
        parseSocksProxy('socks5h://127.0.0.1:1'),
    );

    try {
        await assert.rejects(
            () =>
                fetch(
                    'https://api.music.yandex.net/users/flomaster-mc/playlists/1054',
                    { dispatcher } as unknown as RequestInit,
                ),
            (err: unknown) => {
                const cause = (err as { cause?: { code?: string } }).cause;
                assert.notEqual(cause?.code, 'UND_ERR_INVALID_ARG');
                return true;
            },
        );
    } finally {
        await dispatcher.close();
    }
});
