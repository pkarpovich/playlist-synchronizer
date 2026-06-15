import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { SyncConfig } from '../config.js';
import { MusicServiceTypes, Playlist, Track } from '../entities.js';
import { BaseMusicService } from './music-providers/base-music.service.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { YandexMusicService } from './music-providers/yandex-music.service.js';
import { LogService } from './log.service.js';
import { SyncService } from './sync.service.js';

interface LogEntry {
    level: string;
    message: string;
}

class StubMusicService extends BaseMusicService {
    isReady = true;
    getPlaylistTracksCalls: Playlist[] = [];
    addCalls: { trackIds: string[]; playlist: Playlist }[] = [];

    constructor(
        private readonly getTracksImpl: (
            playlist: Playlist,
        ) => Promise<Track[]>,
    ) {
        super();
    }

    async getPlaylistTracks(playlist: Playlist): Promise<Track[]> {
        this.getPlaylistTracksCalls.push(playlist);
        return this.getTracksImpl(playlist);
    }

    async searchTrackByName(
        name: string,
        artists: string[],
    ): Promise<Track | null> {
        return { id: `found-${name}`, name, artists };
    }

    async addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void> {
        this.addCalls.push({ trackIds, playlist });
    }

    async removeTracksFromPlaylist(): Promise<void> {
        return;
    }
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

function makeSyncConfig(): SyncConfig {
    return {
        playlists: [
            {
                type: MusicServiceTypes.YANDEX_MUSIC,
                metadata: { id: 'bad', userName: 'u', name: 'Bad Source' },
                excludedTrackIds: [],
                targetPlaylists: [
                    {
                        type: MusicServiceTypes.SPOTIFY,
                        metadata: {
                            id: 'sp-bad',
                            userName: 'u',
                            name: 'Bad Target',
                        },
                    },
                ],
            },
            {
                type: MusicServiceTypes.YANDEX_MUSIC,
                metadata: { id: 'good', userName: 'u', name: 'Good Source' },
                excludedTrackIds: [],
                targetPlaylists: [
                    {
                        type: MusicServiceTypes.SPOTIFY,
                        metadata: {
                            id: 'sp-good',
                            userName: 'u',
                            name: 'Good Target',
                        },
                    },
                ],
            },
        ],
    };
}

function makeHarness() {
    const logs: LogEntry[] = [];

    const source = new StubMusicService(async (playlist) => {
        if (playlist.id === 'bad') {
            throw new Error('source unavailable');
        }
        return [{ name: 'Song', artists: ['Artist'] }];
    });

    const target = new StubMusicService(async () => []);

    const syncService = new SyncService(
        makeLogStub(logs),
        source as unknown as YandexMusicService,
        target as unknown as SpotifyService,
    );

    return { logs, source, target, syncService };
}

test('syncAll skips a playlist whose source throws and processes the rest', async () => {
    const { target, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    assert.equal(target.addCalls.length, 1);
    assert.equal(target.addCalls[0].playlist.id, 'sp-good');
    assert.deepEqual(target.addCalls[0].trackIds, ['found-Song']);
});

test('syncAll logs a clear error for the failed playlist', async () => {
    const { logs, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    const errors = logs.filter((l) => l.level === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Bad Source/);
    assert.match(errors[0].message, /source unavailable/);
});

test('syncAll records no false success when the source throws', async () => {
    const { logs, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    const falseSuccess = logs.filter(
        (l) =>
            l.level === 'success' &&
            (l.message.includes('Bad Source') ||
                l.message.includes('Bad Target')),
    );
    assert.equal(falseSuccess.length, 0);

    assert.equal(syncService.statistics.newTracks, 1);
    assert.equal(syncService.statistics.totalTracksInOriginalPlaylists, 1);
});

test('syncAll does not throw when every playlist source fails', async () => {
    const logs: LogEntry[] = [];
    const source = new StubMusicService(async () => {
        throw new Error('boom');
    });
    const target = new StubMusicService(async () => []);
    const syncService = new SyncService(
        makeLogStub(logs),
        source as unknown as YandexMusicService,
        target as unknown as SpotifyService,
    );

    await assert.doesNotReject(() => syncService.syncAll(makeSyncConfig()));
    assert.equal(target.addCalls.length, 0);
    assert.equal(logs.filter((l) => l.level === 'error').length, 2);
});
