import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { IConfig, SyncConfig } from '../config.js';
import { LastRun, MusicServiceTypes, Playlist, Track } from '../entities.js';
import { BaseMusicService } from './music-providers/base-music.service.js';
import { SpotifyAuthService } from './music-providers/spotify-auth.service.js';
import { DelayFn } from '../utils/delay.js';
import { SpotifyFetchFn } from './music-providers/spotify-types.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { YandexMusicService } from './music-providers/yandex-music.service.js';
import { ConfigService } from './config.service.js';
import { DbService } from './db.service.js';
import { LogService } from './log.service.js';
import { Notifier } from './notifications/notifier.js';
import { SyncService } from './sync.service.js';
import {
    TrackMappingResult,
    TrackMappingService,
} from './track-mapping.service.js';

const StartTime = 1750000000000;

interface LogEntry {
    level: string;
    message: string;
}

class NotifierStub implements Notifier {
    calls: (LastRun | null)[] = [];

    async notify(lastRun: LastRun | null): Promise<void> {
        this.calls.push(lastRun);
    }
}

class StubMusicService extends BaseMusicService {
    isReady = true;
    getPlaylistTracksCalls: Playlist[] = [];
    addCalls: { trackIds: string[]; playlist: Playlist }[] = [];
    removeCalls: { uris: string[]; playlist: Playlist }[] = [];

    private readonly contents = new Map<string, string[]>();

    constructor(
        private readonly getTracksImpl: (
            playlist: Playlist,
        ) => Promise<Track[]> = async () => [],
    ) {
        super();
    }

    setUris(playlistId: string, uris: string[]): void {
        this.contents.set(playlistId, uris);
    }

    getUris(playlistId: string): string[] {
        return this.contents.get(playlistId) ?? [];
    }

    async getPlaylistTracks(playlist: Playlist): Promise<Track[]> {
        this.getPlaylistTracksCalls.push(playlist);
        return this.getTracksImpl(playlist);
    }

    async getPlaylistTrackUris({ id }: Playlist): Promise<string[]> {
        return this.getUris(id);
    }

    async addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void> {
        this.addCalls.push({ trackIds, playlist });
        this.setUris(playlist.id, [...this.getUris(playlist.id), ...trackIds]);
    }

    async removeTracksFromPlaylist(
        uris: string[],
        playlist: Playlist,
    ): Promise<void> {
        this.removeCalls.push({ uris, playlist });
        this.setUris(
            playlist.id,
            this.getUris(playlist.id).filter((uri) => !uris.includes(uri)),
        );
    }
}

class TrackMappingStub {
    mapping = new Map<string, string>();
    sourceTypes: MusicServiceTypes[] = [];
    requestedIds: string[] = [];

    get resolveCalls(): number {
        return this.sourceTypes.length;
    }

    skippedIds = new Set<string>();

    async resolve(
        sourceType: MusicServiceTypes,
        sourceTracks: Track[],
    ): Promise<TrackMappingResult> {
        this.sourceTypes.push(sourceType);
        this.requestedIds.push(...sourceTracks.map(({ id }) => id ?? ''));
        const mapping = new Map<string, string>();
        let skipped = 0;

        for (const { id } of sourceTracks) {
            if (id && this.skippedIds.has(id)) {
                skipped += 1;
                continue;
            }

            const targetUri = id ? this.mapping.get(id) : undefined;

            if (id && targetUri) {
                mapping.set(id, targetUri);
            }
        }

        return { mapping, skipped };
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

function makeSingleConfig(): SyncConfig {
    return { playlists: [makeSyncConfig().playlists[1]] };
}

function makeSyncService(
    logs: LogEntry[],
    source: StubMusicService,
    target: StubMusicService,
    notifier: Notifier,
    trackMapping: TrackMappingStub,
): { syncService: SyncService; dbService: DbService } {
    const dbService = new DbService(
        new ConfigService<IConfig>({ dbPath: ':memory:' } as IConfig),
        makeLogStub(logs),
    );

    const syncService = new SyncService(
        makeLogStub(logs),
        source as unknown as YandexMusicService,
        target as unknown as SpotifyService,
        notifier,
        dbService,
        trackMapping as unknown as TrackMappingService,
        () => StartTime,
    );

    return { syncService, dbService };
}

function makeHarness(
    getTracksImpl: (playlist: Playlist) => Promise<Track[]> = async (
        playlist,
    ) => {
        if (playlist.id === 'bad') {
            throw new Error('source unavailable');
        }
        return [{ id: 'y-1', name: 'Song', artists: ['Artist'] }];
    },
) {
    const logs: LogEntry[] = [];
    const source = new StubMusicService(getTracksImpl);
    const target = new StubMusicService();
    const notifier = new NotifierStub();
    const trackMapping = new TrackMappingStub();
    trackMapping.mapping.set('y-1', 'spotify:track:1');
    trackMapping.mapping.set('y-2', 'spotify:track:2');

    const { syncService, dbService } = makeSyncService(
        logs,
        source,
        target,
        notifier,
        trackMapping,
    );

    return {
        logs,
        source,
        target,
        notifier,
        trackMapping,
        syncService,
        dbService,
    };
}

function playlistState(
    dbService: DbService,
    targetPlaylistId: string,
    sourcePlaylistId = 'good',
) {
    return dbService.listPlaylistState({
        targetType: MusicServiceTypes.SPOTIFY,
        targetPlaylistId,
        sourcePlaylistId,
    });
}

test('syncAll skips a playlist whose source throws and processes the rest', async () => {
    const { target, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    assert.equal(target.addCalls.length, 1);
    assert.equal(target.addCalls[0].playlist.id, 'sp-good');
    assert.deepEqual(target.addCalls[0].trackIds, ['spotify:track:1']);
});

test('syncAll logs a clear error for the failed playlist', async () => {
    const { logs, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    const errors = logs.filter((l) => l.level === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Bad Source/);
    assert.match(errors[0].message, /source unavailable/);
});

test('syncAll records run facts without false success when the source throws', async () => {
    const { logs, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    const falseSuccess = logs.filter(
        (l) =>
            l.level === 'success' &&
            (l.message.includes('Bad Source') ||
                l.message.includes('Bad Target')),
    );
    assert.equal(falseSuccess.length, 0);

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    assert.equal(lastRun.status, 'partial');

    const bad = lastRun.playlists.find((p) => p.name === 'Bad Source');
    assert.equal(bad?.status, 'failed');
    assert.match(bad?.error ?? '', /source unavailable/);
    assert.equal(bad?.added, 0);
    assert.equal(bad?.removed, 0);
    assert.equal(bad?.adopted, 0);

    const good = lastRun.playlists.find((p) => p.name === 'Good Source');
    assert.equal(good?.status, 'ok');
    assert.equal(good?.sourceTracks, 1);
    assert.equal(good?.matched, 1);
    assert.equal(good?.added, 1);
    assert.equal(good?.removed, 0);
    assert.equal(good?.adopted, 0);
    assert.equal(good?.notFound, 0);
});

test('lastRun is null before any run', () => {
    const { syncService } = makeHarness();

    assert.equal(syncService.lastRun, null);
});

test('syncAll notifies once with the recorded run after finishing', async () => {
    const { notifier, syncService } = makeHarness();

    await syncService.syncAll(makeSyncConfig());

    assert.equal(notifier.calls.length, 1);
    assert.equal(notifier.calls[0], syncService.lastRun);
});

test('syncAll records ok for every playlist when all succeed', async () => {
    const { syncService } = makeHarness(async () => [
        { id: 'y-1', name: 'Song', artists: ['Artist'] },
    ]);

    await syncService.syncAll(makeSyncConfig());

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    assert.equal(lastRun.status, 'ok');
    assert.equal(lastRun.playlists.length, 2);
    assert.ok(lastRun.playlists.every((p) => p.status === 'ok'));
    assert.ok(lastRun.finishedAt >= lastRun.startedAt);
    assert.equal(lastRun.durationMs, lastRun.finishedAt - lastRun.startedAt);
});

test('syncAll records empty-source when the source has no tracks', async () => {
    const { syncService, trackMapping } = makeHarness(async () => []);

    await syncService.syncAll(makeSyncConfig());

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    assert.ok(lastRun.playlists.every((p) => p.status === 'empty-source'));
    assert.equal(lastRun.playlists[0].sourceTracks, 0);
    assert.equal(trackMapping.resolveCalls, 0);
});

test('syncAll records failed when the services are not ready', async () => {
    const { syncService, target } = makeHarness(async () => [
        { id: 'y-1', name: 'Song', artists: ['Artist'] },
    ]);
    target.isReady = false;

    await syncService.syncAll(makeSyncConfig());

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    assert.equal(lastRun.status, 'failed');
    assert.ok(
        lastRun.playlists.every(
            (p) =>
                p.status === 'failed' &&
                p.error === 'services not ready: spotify',
        ),
    );
    assert.equal(target.addCalls.length, 0);
});

test('syncAll counts source tracks the mapping cannot resolve as notFound', async () => {
    const { syncService } = makeHarness(async (playlist) => {
        if (playlist.id === 'bad') {
            throw new Error('source unavailable');
        }
        return [
            { id: 'y-1', name: 'Found', artists: ['Artist'] },
            { id: 'y-missing', name: 'Missing', artists: ['Artist'] },
        ];
    });

    await syncService.syncAll(makeSyncConfig());

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    const good = lastRun.playlists.find((p) => p.name === 'Good Source');
    assert.equal(good?.status, 'ok');
    assert.equal(good?.sourceTracks, 2);
    assert.equal(good?.matched, 1);
    assert.equal(good?.notFound, 1);
});

test('sync resolves the source once and adds to every target', async () => {
    const { syncService, target, trackMapping } = makeHarness(async () => [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: 'B', artists: ['Artist'] },
    ]);

    const config: SyncConfig = {
        playlists: [
            {
                type: MusicServiceTypes.YANDEX_MUSIC,
                metadata: { id: 'src', userName: 'u', name: 'Source' },
                targetPlaylists: [
                    {
                        type: MusicServiceTypes.SPOTIFY,
                        metadata: {
                            id: 'sp-1',
                            userName: 'u',
                            name: 'Target 1',
                        },
                    },
                    {
                        type: MusicServiceTypes.SPOTIFY,
                        metadata: {
                            id: 'sp-2',
                            userName: 'u',
                            name: 'Target 2',
                        },
                    },
                ],
            },
        ],
    };

    await syncService.syncAll(config);

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    const playlist = lastRun.playlists[0];
    assert.equal(playlist.sourceTracks, 2);
    assert.equal(playlist.matched, 2);
    assert.equal(playlist.notFound, 0);
    assert.equal(playlist.added, 4);
    assert.equal(trackMapping.resolveCalls, 1);
    assert.deepEqual(
        target.addCalls.map(({ playlist: { id } }) => id),
        ['sp-1', 'sp-2'],
    );
});

test('syncAll does not throw when every playlist source fails', async () => {
    const { syncService, target, logs } = makeHarness(async () => {
        throw new Error('boom');
    });

    await assert.doesNotReject(() => syncService.syncAll(makeSyncConfig()));
    assert.equal(target.addCalls.length, 0);
    assert.equal(logs.filter((l) => l.level === 'error').length, 2);
});

test('an empty playlist_state yields zero removals whatever the target holds', async () => {
    const { syncService, target, dbService } = makeHarness();
    target.setUris('sp-good', [
        'spotify:track:stranger',
        'spotify:track:other',
    ]);

    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.removeCalls.length, 0);
    assert.deepEqual(target.addCalls[0].trackIds, ['spotify:track:1']);
    assert.deepEqual(
        playlistState(dbService, 'sp-good').map(({ targetUri }) => targetUri),
        ['spotify:track:1'],
    );
});

test('two source playlists sharing a target keep each other tracks', async () => {
    const { syncService, target } = makeHarness(async ({ id }) => [
        id === 'src-a'
            ? { id: 'y-1', name: 'A', artists: ['Artist'] }
            : { id: 'y-2', name: 'B', artists: ['Artist'] },
    ]);
    const sharedConfig: SyncConfig = {
        playlists: ['src-a', 'src-b'].map((id) => ({
            type: MusicServiceTypes.YANDEX_MUSIC,
            metadata: { id, userName: 'u', name: id },
            targetPlaylists: [
                {
                    type: MusicServiceTypes.SPOTIFY,
                    metadata: {
                        id: 'sp-shared',
                        userName: 'u',
                        name: 'Shared Target',
                    },
                },
            ],
        })),
    };

    await syncService.syncAll(sharedConfig);
    await syncService.syncAll(sharedConfig);

    assert.equal(target.removeCalls.length, 0);
    assert.deepEqual(target.getUris('sp-shared'), [
        'spotify:track:1',
        'spotify:track:2',
    ]);
});

test('a URI another source still holds survives this source dropping it', async () => {
    let tracksA: Track[] = [
        { id: 'y-a1', name: 'Shared', artists: ['Artist'] },
        { id: 'y-a2', name: 'Own', artists: ['Artist'] },
    ];
    const { syncService, target, trackMapping, dbService } = makeHarness(
        async ({ id }) =>
            id === 'src-a'
                ? tracksA
                : [{ id: 'y-b1', name: 'Shared', artists: ['Artist'] }],
    );
    trackMapping.mapping.set('y-a1', 'spotify:track:shared');
    trackMapping.mapping.set('y-b1', 'spotify:track:shared');
    trackMapping.mapping.set('y-a2', 'spotify:track:own');
    const sharedConfig: SyncConfig = {
        playlists: ['src-a', 'src-b'].map((id) => ({
            type: MusicServiceTypes.YANDEX_MUSIC,
            metadata: { id, userName: 'u', name: id },
            targetPlaylists: [
                {
                    type: MusicServiceTypes.SPOTIFY,
                    metadata: {
                        id: 'sp-shared',
                        userName: 'u',
                        name: 'Shared Target',
                    },
                },
            ],
        })),
    };

    await syncService.syncAll(sharedConfig);
    assert.deepEqual(target.getUris('sp-shared'), [
        'spotify:track:shared',
        'spotify:track:own',
    ]);

    tracksA = [{ id: 'y-a2', name: 'Own', artists: ['Artist'] }];
    await syncService.syncAll(sharedConfig);

    assert.equal(target.removeCalls.length, 0);
    assert.deepEqual(target.getUris('sp-shared'), [
        'spotify:track:shared',
        'spotify:track:own',
    ]);
    assert.deepEqual(
        playlistState(dbService, 'sp-shared', 'src-a').map(
            ({ targetUri }) => targetUri,
        ),
        ['spotify:track:own'],
    );
    assert.deepEqual(
        playlistState(dbService, 'sp-shared', 'src-b').map(
            ({ targetUri }) => targetUri,
        ),
        ['spotify:track:shared'],
    );
});

test('a URI is removed once the last source holding it drops it', async () => {
    let tracksA: Track[] = [
        { id: 'y-a1', name: 'Shared', artists: ['Artist'] },
        { id: 'y-a2', name: 'Own', artists: ['Artist'] },
    ];
    let tracksB: Track[] = [
        { id: 'y-b1', name: 'Shared', artists: ['Artist'] },
    ];
    const { syncService, target, trackMapping } = makeHarness(async ({ id }) =>
        id === 'src-a' ? tracksA : tracksB,
    );
    trackMapping.mapping.set('y-a1', 'spotify:track:shared');
    trackMapping.mapping.set('y-b1', 'spotify:track:shared');
    trackMapping.mapping.set('y-a2', 'spotify:track:own');
    trackMapping.mapping.set('y-b2', 'spotify:track:b-own');
    const sharedConfig: SyncConfig = {
        playlists: ['src-a', 'src-b'].map((id) => ({
            type: MusicServiceTypes.YANDEX_MUSIC,
            metadata: { id, userName: 'u', name: id },
            targetPlaylists: [
                {
                    type: MusicServiceTypes.SPOTIFY,
                    metadata: {
                        id: 'sp-shared',
                        userName: 'u',
                        name: 'Shared Target',
                    },
                },
            ],
        })),
    };

    await syncService.syncAll(sharedConfig);

    tracksA = [{ id: 'y-a2', name: 'Own', artists: ['Artist'] }];
    tracksB = [{ id: 'y-b2', name: 'B Own', artists: ['Artist'] }];
    await syncService.syncAll(sharedConfig);

    assert.equal(target.removeCalls.length, 1);
    assert.deepEqual(target.removeCalls[0].uris, ['spotify:track:shared']);
    assert.deepEqual(target.getUris('sp-shared'), [
        'spotify:track:own',
        'spotify:track:b-own',
    ]);
});

test('a source track that disappears removes exactly its recorded URI', async () => {
    let sourceTracks: Track[] = [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: 'B', artists: ['Artist'] },
    ];
    const { syncService, target, dbService } = makeHarness(
        async () => sourceTracks,
    );

    await syncService.syncAll(makeSingleConfig());
    assert.deepEqual(target.getUris('sp-good'), [
        'spotify:track:1',
        'spotify:track:2',
    ]);

    sourceTracks = [{ id: 'y-1', name: 'A', artists: ['Artist'] }];
    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.removeCalls.length, 1);
    assert.deepEqual(target.removeCalls[0].uris, ['spotify:track:2']);
    assert.deepEqual(target.getUris('sp-good'), ['spotify:track:1']);
    assert.deepEqual(
        playlistState(dbService, 'sp-good').map(({ targetUri }) => targetUri),
        ['spotify:track:1'],
    );

    const lastRun = syncService.lastRun;
    assert.equal(lastRun?.playlists[0].removed, 1);
});

test('a source track that turns unavailable keeps its recorded URI', async () => {
    let sourceTracks: Track[] = [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: 'B', artists: ['Artist'] },
    ];
    const { syncService, target, dbService } = makeHarness(
        async () => sourceTracks,
    );

    await syncService.syncAll(makeSingleConfig());
    assert.deepEqual(target.getUris('sp-good'), [
        'spotify:track:1',
        'spotify:track:2',
    ]);

    sourceTracks = [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: '', artists: [], unavailable: true },
    ];
    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.removeCalls.length, 0);
    assert.deepEqual(target.getUris('sp-good'), [
        'spotify:track:1',
        'spotify:track:2',
    ]);
    assert.deepEqual(
        playlistState(dbService, 'sp-good').map(({ targetUri }) => targetUri),
        ['spotify:track:1', 'spotify:track:2'],
    );

    const lastRun = syncService.lastRun;
    assert.equal(lastRun?.playlists[0].removed, 0);
    assert.equal(lastRun?.playlists[0].sourceTracks, 1);
    assert.equal(lastRun?.playlists[0].notFound, 0);
});

test('an unavailable source track is never handed to the track mapping', async () => {
    const { syncService, trackMapping } = makeHarness(async () => [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: '', artists: [], unavailable: true },
    ]);

    await syncService.syncAll(makeSingleConfig());

    assert.deepEqual(trackMapping.requestedIds, ['y-1']);
});

test('a URI another source track still maps to survives its provenance source leaving', async () => {
    let sourceTracks: Track[] = [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: 'A', artists: ['Artist'] },
    ];
    const { syncService, target, trackMapping } = makeHarness(
        async () => sourceTracks,
    );
    trackMapping.mapping.set('y-2', 'spotify:track:1');

    await syncService.syncAll(makeSingleConfig());
    assert.deepEqual(target.getUris('sp-good'), ['spotify:track:1']);

    sourceTracks = [{ id: 'y-2', name: 'A', artists: ['Artist'] }];
    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.removeCalls.length, 0);
    assert.deepEqual(target.getUris('sp-good'), ['spotify:track:1']);
    assert.equal(syncService.lastRun?.playlists[0].removed, 0);
});

test('a target track with no provenance row is never removed', async () => {
    let sourceTracks: Track[] = [
        { id: 'y-1', name: 'A', artists: ['Artist'] },
        { id: 'y-2', name: 'B', artists: ['Artist'] },
    ];
    const { syncService, target } = makeHarness(async () => sourceTracks);
    target.setUris('sp-good', ['spotify:track:manual']);

    await syncService.syncAll(makeSingleConfig());

    sourceTracks = [{ id: 'y-1', name: 'A', artists: ['Artist'] }];
    await syncService.syncAll(makeSingleConfig());

    assert.deepEqual(target.removeCalls[0].uris, ['spotify:track:2']);
    assert.ok(target.getUris('sp-good').includes('spotify:track:manual'));
});

test('a URI present three times is removed once and re-added once', async () => {
    const { syncService, target } = makeHarness();
    target.setUris('sp-good', [
        'spotify:track:1',
        'spotify:track:1',
        'spotify:track:1',
    ]);

    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.removeCalls.length, 1);
    assert.deepEqual(target.removeCalls[0].uris, ['spotify:track:1']);
    assert.equal(target.addCalls.length, 1);
    assert.deepEqual(target.addCalls[0].trackIds, ['spotify:track:1']);
    assert.deepEqual(target.getUris('sp-good'), ['spotify:track:1']);

    const lastRun = syncService.lastRun;
    assert.equal(lastRun?.playlists[0].removed, 0);
    assert.equal(lastRun?.playlists[0].added, 0);
});

test('a duplicated URI with no provenance row is left untouched', async () => {
    const { syncService, target } = makeHarness();
    target.setUris('sp-good', [
        'spotify:track:manual',
        'spotify:track:manual',
        'spotify:track:1',
    ]);

    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.removeCalls.length, 0);
    assert.equal(target.addCalls.length, 0);
    assert.deepEqual(target.getUris('sp-good'), [
        'spotify:track:manual',
        'spotify:track:manual',
        'spotify:track:1',
    ]);
});

test('adoption inserts provenance for already-present desired URIs', async () => {
    const { syncService, target, dbService } = makeHarness();
    target.setUris('sp-good', ['spotify:track:1']);

    await syncService.syncAll(makeSingleConfig());

    assert.equal(target.addCalls.length, 0);
    assert.equal(target.removeCalls.length, 0);
    assert.deepEqual(playlistState(dbService, 'sp-good'), [
        {
            targetUri: 'spotify:track:1',
            sourceType: MusicServiceTypes.YANDEX_MUSIC,
            sourceId: 'y-1',
            addedAt: StartTime,
        },
    ]);

    const lastRun = syncService.lastRun;
    assert.equal(lastRun?.playlists[0].adopted, 1);
});

test('a revoked Spotify authorization records a failed run without throwing', async () => {
    const logs: LogEntry[] = [];
    const calls: string[] = [];
    const dbService = new DbService(
        new ConfigService<IConfig>({ dbPath: ':memory:' } as IConfig),
        makeLogStub(logs),
    );
    dbService.setRevokedAt('spotify', StartTime);

    const fetchFn: SpotifyFetchFn = async (url) => {
        calls.push(url);
        throw new Error('no Spotify request was expected');
    };
    const delays: number[] = [];
    const delayFn: DelayFn = async (ms) => {
        delays.push(ms);
    };

    const spotifyAuthService = new SpotifyAuthService(
        dbService,
        new ConfigService<IConfig>({
            spotify: {
                clientId: 'client-1',
                clientSecret: 'secret-1',
                redirectUri: 'https://sync.example/spotify/callback',
            },
        } as IConfig),
        makeLogStub(logs),
        fetchFn,
        () => StartTime,
        delayFn,
    );

    await spotifyAuthService.initialize();
    assert.equal(spotifyAuthService.state, 'needs-reauthorization');

    const source = new StubMusicService(async () => [
        { id: 'y-1', name: 'Song', artists: ['Artist'] },
    ]);
    const trackMapping = new TrackMappingStub();
    const syncService = new SyncService(
        makeLogStub(logs),
        source as unknown as YandexMusicService,
        new SpotifyService(
            spotifyAuthService,
            makeLogStub(logs),
            fetchFn,
            delayFn,
        ),
        new NotifierStub(),
        dbService,
        trackMapping as unknown as TrackMappingService,
        () => StartTime,
    );

    await assert.doesNotReject(() => syncService.syncAll(makeSingleConfig()));

    const lastRun = syncService.lastRun;
    assert.ok(lastRun);
    assert.equal(lastRun.status, 'failed');
    assert.equal(lastRun.playlists[0].status, 'failed');
    assert.match(lastRun.playlists[0].error ?? '', /not ready/);
    assert.equal(calls.length, 0);
    assert.deepEqual(delays, []);
    assert.equal(trackMapping.resolveCalls, 0);
});

test('an added track is recorded with its source id and stays recorded', async () => {
    const { syncService, dbService } = makeHarness();

    await syncService.syncAll(makeSingleConfig());
    await syncService.syncAll(makeSingleConfig());

    assert.deepEqual(playlistState(dbService, 'sp-good'), [
        {
            targetUri: 'spotify:track:1',
            sourceType: MusicServiceTypes.YANDEX_MUSIC,
            sourceId: 'y-1',
            addedAt: StartTime,
        },
    ]);
});

test('skipped source tracks are counted apart from notFound', async () => {
    const harness = makeHarness(async () => [
        { id: 'y-1', name: 'Song', artists: ['Artist'] },
        { id: 'y-2', name: 'Other', artists: ['Artist'] },
        { id: 'y-3', name: 'Absent', artists: ['Artist'] },
        { id: 'y-4', name: 'Nowhere', artists: ['Artist'] },
    ]);
    harness.trackMapping.skippedIds.add('y-3');

    await harness.syncService.syncAll(makeSingleConfig());

    const [playlist] = harness.syncService.lastRun?.playlists ?? [];

    assert.equal(playlist.sourceTracks, 4);
    assert.equal(playlist.matched, 2);
    assert.equal(playlist.skipped, 1);
    assert.equal(playlist.notFound, 1);
    assert.equal(playlist.status, 'ok');
});
