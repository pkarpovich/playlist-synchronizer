import { YandexMusicService } from './music-providers/yandex-music.service.js';
import { BaseMusicService } from './music-providers/base-music.service.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { LoggerContext, LogService } from './log.service.js';
import { Notifier } from './notifications/notifier.js';
import { DbService, PlaylistStateKey } from './db.service.js';
import { TrackMappingService } from './track-mapping.service.js';
import { PlaylistConfig, SyncConfig } from '../config.js';
import {
    MusicServiceTypes,
    Playlist,
    Track,
    PlaylistRunResult,
    LastRun,
    computeRunStatus,
} from '../entities.js';

type TargetPlaylistConfig = PlaylistConfig['targetPlaylists'][number];

type TargetOutcome = {
    added: number;
    removed: number;
    adopted: number;
};

function countUris(uris: string[]): Map<string, number> {
    const counts = new Map<string, number>();

    for (const uri of uris) {
        counts.set(uri, (counts.get(uri) ?? 0) + 1);
    }

    return counts;
}

function buildDesired(
    sourceTracks: Track[],
    mapping: Map<string, string>,
): Map<string, string> {
    const desired = new Map<string, string>();

    for (const { id } of sourceTracks) {
        const targetUri = id ? mapping.get(id) : undefined;

        if (!id || !targetUri || desired.has(targetUri)) {
            continue;
        }

        desired.set(targetUri, id);
    }

    return desired;
}

export class SyncService {
    private _lastRun: LastRun | null = null;

    get lastRun(): LastRun | null {
        return this._lastRun;
    }

    constructor(
        private readonly logService: LogService,
        private readonly yandexMusicService: YandexMusicService,
        private readonly spotifyService: SpotifyService,
        private readonly notifier: Notifier,
        private readonly dbService: DbService,
        private readonly trackMappingService: TrackMappingService,
        private readonly now: () => number,
    ) {}

    async syncAll(syncConfig: SyncConfig): Promise<void> {
        const startedAt = Date.now();
        const playlists: PlaylistRunResult[] = [];

        for (const playlistConfig of syncConfig.playlists) {
            const loggerCtx: LoggerContext = {
                scope: this.logService.createScope(
                    playlistConfig.metadata.name,
                ),
            };

            this.logService.info(
                `Start sync ${playlistConfig.metadata.name} playlist`,
                loggerCtx,
            );

            try {
                playlists.push(await this.sync(playlistConfig, loggerCtx));
            } catch (error) {
                const reason =
                    error instanceof Error ? error.message : String(error);
                this.logService.error(
                    `Failed to sync ${playlistConfig.metadata.name} playlist: ${reason}`,
                    loggerCtx,
                );
                playlists.push({
                    name: playlistConfig.metadata.name,
                    status: 'failed',
                    sourceTracks: 0,
                    matched: 0,
                    added: 0,
                    removed: 0,
                    adopted: 0,
                    notFound: 0,
                    skipped: 0,
                    error: reason,
                });
            }
        }

        const finishedAt = Date.now();
        this._lastRun = {
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            status: computeRunStatus(playlists),
            playlists,
        };

        await this.notifier.notify(this._lastRun);
    }

    isAllServicesReady(): boolean {
        return this.notReadyServices().length === 0;
    }

    private notReadyServices(): string[] {
        return [
            { name: 'yandex', service: this.yandexMusicService },
            { name: 'spotify', service: this.spotifyService },
        ]
            .filter(({ service }) => !service.isReady)
            .map(({ name }) => name);
    }

    async sync(
        syncConfig: PlaylistConfig,
        loggerCtx: LoggerContext,
    ): Promise<PlaylistRunResult> {
        const result: PlaylistRunResult = {
            name: syncConfig.metadata.name,
            status: 'ok',
            sourceTracks: 0,
            matched: 0,
            added: 0,
            removed: 0,
            adopted: 0,
            notFound: 0,
            skipped: 0,
        };

        const notReady = this.notReadyServices();
        if (notReady.length) {
            const reason = `services not ready: ${notReady.join(', ')}`;
            this.logService.await(`Skip sync. ${reason}`);
            return { ...result, status: 'failed', error: reason };
        }

        const sourcePlaylistTracks = await this.getPlaylistTracks(
            syncConfig.type,
            syncConfig.metadata,
            loggerCtx,
        );
        const availableTracks = sourcePlaylistTracks.filter(
            ({ unavailable }) => !unavailable,
        );
        result.sourceTracks = availableTracks.length;

        if (!availableTracks.length) {
            return { ...result, status: 'empty-source' };
        }

        const { mapping, skipped } = await this.trackMappingService.resolve(
            syncConfig.type,
            availableTracks,
        );
        result.matched = mapping.size;
        result.skipped = skipped;
        result.notFound = result.sourceTracks - mapping.size - skipped;

        for (const target of syncConfig.targetPlaylists) {
            const outcome = await this.syncTarget(
                syncConfig.type,
                syncConfig.metadata.id,
                sourcePlaylistTracks,
                mapping,
                target,
                loggerCtx,
            );

            result.added += outcome.added;
            result.removed += outcome.removed;
            result.adopted += outcome.adopted;
        }

        this.logService.success('Sync completed', loggerCtx);
        return result;
    }

    private async syncTarget(
        sourceType: MusicServiceTypes,
        sourcePlaylistId: string,
        sourceTracks: Track[],
        mapping: Map<string, string>,
        target: TargetPlaylistConfig,
        loggerCtx: LoggerContext,
    ): Promise<TargetOutcome> {
        const service = this.getMusicServiceByType(target.type);
        const key: PlaylistStateKey = {
            targetType: target.type,
            targetPlaylistId: target.metadata.id,
            sourcePlaylistId,
        };

        const presentCounts = countUris(
            await service.getPlaylistTrackUris(target.metadata),
        );
        const desired = buildDesired(sourceTracks, mapping);
        const provenance = this.dbService.listPlaylistState(key);
        const recordedUris = new Set(
            provenance.map(({ targetUri }) => targetUri),
        );

        const adopted = [...desired].filter(
            ([targetUri]) =>
                presentCounts.has(targetUri) && !recordedUris.has(targetUri),
        );
        this.recordAdditions(key, sourceType, adopted);
        if (adopted.length) {
            this.logService.success(
                `Adopted ${adopted.length} existing tracks in ${target.metadata.name} playlist`,
                loggerCtx,
            );
        }

        const toAdd = [...desired].filter(
            ([targetUri]) => !presentCounts.has(targetUri),
        );
        if (toAdd.length) {
            await service.addTracksToPlaylist(
                toAdd.map(([targetUri]) => targetUri),
                target.metadata,
            );
            this.recordAdditions(key, sourceType, toAdd);
            this.logService.success(
                `Added ${toAdd.length} tracks to ${target.metadata.name} playlist`,
                loggerCtx,
            );
        }

        const currentSourceIds = new Set(sourceTracks.map(({ id }) => id));
        const releasedUris = provenance
            .filter(
                ({ targetUri, sourceId }) =>
                    !currentSourceIds.has(sourceId) && !desired.has(targetUri),
            )
            .map(({ targetUri }) => targetUri);
        const claimedElsewhere = new Set(
            this.dbService.listOtherSourceUris(key),
        );
        this.dbService.deletePlaylistState(
            key,
            releasedUris.filter((targetUri) => claimedElsewhere.has(targetUri)),
        );

        const staleUris = releasedUris.filter(
            (targetUri) => !claimedElsewhere.has(targetUri),
        );
        if (staleUris.length) {
            await service.removeTracksFromPlaylist(staleUris, target.metadata);
            this.dbService.deletePlaylistState(key, staleUris);
            this.logService.success(
                `Removed ${staleUris.length} tracks from ${target.metadata.name} playlist`,
                loggerCtx,
            );
        }

        const stale = new Set(staleUris);
        const owned = new Set([
            ...recordedUris,
            ...adopted.map(([targetUri]) => targetUri),
        ]);
        const duplicateUris = [...presentCounts]
            .filter(
                ([targetUri, count]) =>
                    count > 1 && !stale.has(targetUri) && owned.has(targetUri),
            )
            .map(([targetUri]) => targetUri);
        if (duplicateUris.length) {
            await service.deduplicateTracks(duplicateUris, target.metadata);
            this.logService.success(
                `Deduplicated ${duplicateUris.length} tracks in ${target.metadata.name} playlist`,
                loggerCtx,
            );
        }

        return {
            added: toAdd.length,
            removed: staleUris.length,
            adopted: adopted.length,
        };
    }

    private recordAdditions(
        key: PlaylistStateKey,
        sourceType: MusicServiceTypes,
        entries: [string, string][],
    ): void {
        const addedAt = this.now();

        for (const [targetUri, sourceId] of entries) {
            this.dbService.addPlaylistState(
                key,
                { targetUri, sourceType, sourceId },
                addedAt,
            );
        }
    }

    private getMusicServiceByType(type: MusicServiceTypes): BaseMusicService {
        switch (type) {
            case MusicServiceTypes.SPOTIFY: {
                return this.spotifyService;
            }
            case MusicServiceTypes.YANDEX_MUSIC: {
                return this.yandexMusicService;
            }
        }
    }

    private async getPlaylistTracks(
        serviceType: MusicServiceTypes,
        playlistMetadata: Playlist,
        loggerCtx: LoggerContext,
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);

        this.logService.await(
            `Try to get tracks from ${playlistMetadata.name} playlist in ${serviceType} service`,
            loggerCtx,
        );
        const tracks = await service.getPlaylistTracks(playlistMetadata);
        this.logService.success(
            `Found ${tracks.length} tracks in ${playlistMetadata.name} playlist in ${serviceType} service`,
            loggerCtx,
        );

        return tracks;
    }
}
