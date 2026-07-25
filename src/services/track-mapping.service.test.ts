import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { IConfig } from '../config.js';
import { MusicServiceTypes, Track } from '../entities.js';
import { ConfigService } from './config.service.js';
import { DbService } from './db.service.js';
import { LogService } from './log.service.js';
import {
    SpotifyResolvedTrack,
    SpotifyService,
} from './music-providers/spotify.service.js';
import { TrackMappingService } from './track-mapping.service.js';

const DayMs = 24 * 60 * 60 * 1000;
const StartTime = 1750000000000;

interface Harness {
    service: TrackMappingService;
    dbService: DbService;
    spotify: SpotifyServiceStub;
    logs: string[];
    setNow: (value: number) => void;
}

class SpotifyServiceStub {
    searchedTracks: Track[] = [];

    results = new Map<string, SpotifyResolvedTrack>();

    async resolveTrack(track: Track): Promise<SpotifyResolvedTrack | null> {
        this.searchedTracks.push(track);

        return this.results.get(track.name) ?? null;
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

function makeHarness(): Harness {
    const logs: string[] = [];
    const dbService = new DbService(
        new ConfigService<IConfig>({ dbPath: ':memory:' } as IConfig),
        makeLogStub(logs),
    );
    const spotify = new SpotifyServiceStub();

    let currentTime = StartTime;

    const service = new TrackMappingService(
        dbService,
        spotify as unknown as SpotifyService,
        makeLogStub(logs),
        () => currentTime,
    );

    return {
        service,
        dbService,
        spotify,
        logs,
        setNow: (value: number) => {
            currentTime = value;
        },
    };
}

function makeTrack(id: string, name: string): Track {
    return { id, name, artists: ['Artist'] };
}

test('an unmapped track is searched once and stored', async () => {
    const { service, dbService, spotify } = makeHarness();
    spotify.results.set('Song', {
        uri: 'spotify:track:1',
        isrc: 'ISRC1',
        durationMs: 1000,
    });

    const mapping = await service.resolve(MusicServiceTypes.YANDEX_MUSIC, [
        makeTrack('yandex-1', 'Song'),
    ]);

    assert.equal(spotify.searchedTracks.length, 1);
    assert.deepEqual([...mapping], [['yandex-1', 'spotify:track:1']]);
    assert.deepEqual(
        dbService.getTrackMap({
            sourceType: MusicServiceTypes.YANDEX_MUSIC,
            sourceId: 'yandex-1',
            targetType: MusicServiceTypes.SPOTIFY,
        }),
        {
            targetUri: 'spotify:track:1',
            isrc: 'ISRC1',
            durationMs: 1000,
            resolvedAt: StartTime,
            lastTriedAt: StartTime,
            attempts: 1,
        },
    );
});

test('a mapped track issues zero searches on the next call', async () => {
    const { service, spotify } = makeHarness();
    spotify.results.set('Song', {
        uri: 'spotify:track:1',
        isrc: null,
        durationMs: null,
    });
    const tracks = [makeTrack('yandex-1', 'Song')];

    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, tracks);
    spotify.searchedTracks = [];

    const mapping = await service.resolve(
        MusicServiceTypes.YANDEX_MUSIC,
        tracks,
    );

    assert.equal(spotify.searchedTracks.length, 0);
    assert.deepEqual([...mapping], [['yandex-1', 'spotify:track:1']]);
});

test('a negative row within 24 hours issues zero searches', async () => {
    const { service, dbService, spotify, setNow } = makeHarness();
    const tracks = [makeTrack('yandex-1', 'Missing')];

    const first = await service.resolve(MusicServiceTypes.YANDEX_MUSIC, tracks);
    assert.equal(first.size, 0);
    assert.equal(spotify.searchedTracks.length, 1);

    setNow(StartTime + DayMs - 1);
    const second = await service.resolve(
        MusicServiceTypes.YANDEX_MUSIC,
        tracks,
    );

    assert.equal(second.size, 0);
    assert.equal(spotify.searchedTracks.length, 1);
    assert.deepEqual(
        dbService.getTrackMap({
            sourceType: MusicServiceTypes.YANDEX_MUSIC,
            sourceId: 'yandex-1',
            targetType: MusicServiceTypes.SPOTIFY,
        }),
        {
            targetUri: null,
            isrc: null,
            durationMs: null,
            resolvedAt: null,
            lastTriedAt: StartTime,
            attempts: 1,
        },
    );
});

test('a negative row older than 24 hours is retried', async () => {
    const { service, dbService, spotify, setNow } = makeHarness();
    const tracks = [makeTrack('yandex-1', 'Missing')];

    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, tracks);

    setNow(StartTime + DayMs);
    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, tracks);

    assert.equal(spotify.searchedTracks.length, 2);
    assert.deepEqual(
        dbService.getTrackMap({
            sourceType: MusicServiceTypes.YANDEX_MUSIC,
            sourceId: 'yandex-1',
            targetType: MusicServiceTypes.SPOTIFY,
        }),
        {
            targetUri: null,
            isrc: null,
            durationMs: null,
            resolvedAt: null,
            lastTriedAt: StartTime + DayMs,
            attempts: 2,
        },
    );
});

test('a later successful retry clears the negative state', async () => {
    const { service, dbService, spotify, setNow } = makeHarness();
    const tracks = [makeTrack('yandex-1', 'Missing')];

    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, tracks);

    setNow(StartTime + DayMs);
    spotify.results.set('Missing', {
        uri: 'spotify:track:2',
        isrc: 'ISRC2',
        durationMs: 2000,
    });
    const mapping = await service.resolve(
        MusicServiceTypes.YANDEX_MUSIC,
        tracks,
    );

    assert.deepEqual([...mapping], [['yandex-1', 'spotify:track:2']]);
    assert.deepEqual(
        dbService.getTrackMap({
            sourceType: MusicServiceTypes.YANDEX_MUSIC,
            sourceId: 'yandex-1',
            targetType: MusicServiceTypes.SPOTIFY,
        }),
        {
            targetUri: 'spotify:track:2',
            isrc: 'ISRC2',
            durationMs: 2000,
            resolvedAt: StartTime + DayMs,
            lastTriedAt: StartTime + DayMs,
            attempts: 2,
        },
    );

    setNow(StartTime + 2 * DayMs);
    spotify.searchedTracks = [];
    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, tracks);

    assert.equal(spotify.searchedTracks.length, 0);
});

test('tracks without an id are skipped', async () => {
    const { service, spotify } = makeHarness();

    const mapping = await service.resolve(MusicServiceTypes.YANDEX_MUSIC, [
        { name: 'Song', artists: ['Artist'] },
    ]);

    assert.equal(mapping.size, 0);
    assert.equal(spotify.searchedTracks.length, 0);
});

test('an unresolved track is logged and counted as unresolved', async () => {
    const { service, dbService, logs } = makeHarness();

    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, [
        makeTrack('yandex-1', 'Missing'),
    ]);

    assert.deepEqual(dbService.countTrackMap(), {
        resolved: 0,
        unresolved: 1,
    });
    assert.ok(logs.some((message) => message.includes('Missing')));
});

test('counts split resolved and unresolved rows', async () => {
    const { service, dbService, spotify } = makeHarness();
    spotify.results.set('Song', {
        uri: 'spotify:track:1',
        isrc: null,
        durationMs: null,
    });

    assert.deepEqual(dbService.countTrackMap(), {
        resolved: 0,
        unresolved: 0,
    });

    await service.resolve(MusicServiceTypes.YANDEX_MUSIC, [
        makeTrack('yandex-1', 'Song'),
        makeTrack('yandex-2', 'Missing'),
    ]);

    assert.deepEqual(dbService.countTrackMap(), {
        resolved: 1,
        unresolved: 1,
    });
});
