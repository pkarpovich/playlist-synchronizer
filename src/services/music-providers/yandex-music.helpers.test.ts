import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
    buildPlaylistUrl,
    mapPlaylistTracks,
    parseSocksProxy,
    YandexPlaylistResponse,
} from './yandex-music.helpers.js';

const fixture = JSON.parse(
    readFileSync(
        new URL('./__fixtures__/yandex-playlist.json', import.meta.url),
        'utf-8',
    ),
) as YandexPlaylistResponse;

test('buildPlaylistUrl composes the official playlist endpoint', () => {
    assert.equal(
        buildPlaylistUrl(
            'https://api.music.yandex.net',
            'flomaster-mc',
            '1054',
        ),
        'https://api.music.yandex.net/users/flomaster-mc/playlists/1054',
    );
});

test('mapPlaylistTracks maps titles and artists from the fixture', () => {
    const tracks = mapPlaylistTracks(fixture);

    assert.equal(tracks.length, 3);
    assert.deepEqual(
        tracks.map(({ name }) => name),
        ['Smells Like Teen Spirit', 'Numb / Encore', 'Bohemian Rhapsody'],
    );
    assert.deepEqual(tracks[0].artists, ['Nirvana']);
});

test('mapPlaylistTracks flattens multi-artist tracks', () => {
    const tracks = mapPlaylistTracks(fixture);

    assert.deepEqual(tracks[1].artists, ['Linkin Park', 'Jay-Z']);
});

test('mapPlaylistTracks keeps the raw track as the track source', () => {
    const tracks = mapPlaylistTracks(fixture);

    assert.deepEqual(tracks[0].source, fixture.result?.tracks?.[0].track);
});

test('mapPlaylistTracks skips unavailable tracks with a null track body', () => {
    const tracks = mapPlaylistTracks({
        result: {
            tracks: [
                { track: null },
                {
                    track: {
                        title: 'Numb',
                        artists: [{ name: 'Linkin Park' }],
                    },
                },
            ],
        },
    });

    assert.deepEqual(tracks, [
        {
            name: 'Numb',
            artists: ['Linkin Park'],
            source: { title: 'Numb', artists: [{ name: 'Linkin Park' }] },
        },
    ]);
});

test('mapPlaylistTracks defaults artists to [] when the track has none', () => {
    const tracks = mapPlaylistTracks({
        result: {
            tracks: [{ track: { title: 'Untitled Instrumental' } }],
        },
    });

    assert.deepEqual(tracks, [
        {
            name: 'Untitled Instrumental',
            artists: [],
            source: { title: 'Untitled Instrumental' },
        },
    ]);
});

test('mapPlaylistTracks skips track bodies that are missing a title', () => {
    const tracks = mapPlaylistTracks({
        result: {
            tracks: [
                { track: { artists: [{ name: 'Linkin Park' }] } },
                {
                    track: {
                        title: 'Numb',
                        artists: [{ name: 'Linkin Park' }],
                    },
                },
            ],
        },
    });

    assert.deepEqual(tracks, [
        {
            name: 'Numb',
            artists: ['Linkin Park'],
            source: { title: 'Numb', artists: [{ name: 'Linkin Park' }] },
        },
    ]);
});

test('mapPlaylistTracks returns [] for an empty playlist', () => {
    assert.deepEqual(mapPlaylistTracks({ result: { tracks: [] } }), []);
});

test('mapPlaylistTracks returns [] when result is missing', () => {
    assert.deepEqual(mapPlaylistTracks({}), []);
});

test('parseSocksProxy extracts host and port from a socks5h url', () => {
    assert.deepEqual(parseSocksProxy('socks5h://100.121.175.96:1080'), {
        type: 5,
        host: '100.121.175.96',
        port: 1080,
    });
});

test('parseSocksProxy throws when the proxy url has no port', () => {
    assert.throws(
        () => parseSocksProxy('socks5h://100.121.175.96'),
        /Invalid YANDEX_API_PROXY/,
    );
});
