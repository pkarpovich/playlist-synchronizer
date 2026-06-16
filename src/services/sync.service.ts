import { YandexMusicService } from './music-providers/yandex-music.service.js';
import { BaseMusicService } from './music-providers/base-music.service.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { LoggerContext, LogService } from './log.service.js';
import { PlaylistConfig, SyncConfig } from '../config.js';
import {
    MusicServiceTypes,
    Playlist,
    Track,
    PlaylistRunResult,
    LastRun,
    computeRunStatus,
} from '../entities.js';

interface PlaylistSyncContext {
    targetService?: BaseMusicService;
    targetPlaylist?: Playlist;
    targetPlaylistTracks?: Track[];
    sourceService: BaseMusicService;
    sourcePlaylist: Playlist;
    sourcePlaylistTracks: Track[];
    loggerCtx: LoggerContext;
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
                    notFound: 0,
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
    }

    isAllServicesReady(): boolean {
        return [this.yandexMusicService, this.spotifyService].every(
            (service) => service.isReady,
        );
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
            notFound: 0,
        };

        const isAllServicesReady = this.isAllServicesReady();
        if (!isAllServicesReady) {
            this.logService.await(
                `Skip sync. Wait for all services to be ready`,
            );
            return {
                ...result,
                status: 'failed',
                error: 'services not ready',
            };
        }

        const sourcePlaylistTracks = await this.getPlaylistTracks(
            syncConfig.type,
            syncConfig.metadata,
            loggerCtx,
        );
        result.sourceTracks = sourcePlaylistTracks.length;

        if (!sourcePlaylistTracks.length) {
            return { ...result, status: 'empty-source' };
        }

        const ctx: PlaylistSyncContext = {
            sourceService: this.getMusicServiceByType(syncConfig.type),
            sourcePlaylist: syncConfig.metadata,
            sourcePlaylistTracks,
            loggerCtx,
        };

        for (const target of syncConfig.targetPlaylists) {
            ctx.targetService = this.getMusicServiceByType(target.type);
            ctx.targetPlaylist = target.metadata;
            ctx.targetPlaylistTracks = await this.getPlaylistTracks(
                target.type,
                target.metadata,
                loggerCtx,
            );

            const tracksForAdd = await this.findTracksInService(
                ctx,
                target.type,
                ctx.sourcePlaylistTracks,
            );
            this.logService.success(
                `Found ${tracksForAdd.length} tracks in ${target.type} service`,
                loggerCtx,
            );
            result.matched += tracksForAdd.length;
            result.notFound +=
                ctx.sourcePlaylistTracks.length - tracksForAdd.length;

            await this.removeDeletedTracks(ctx, tracksForAdd);

            const trackIdsForAdd: string[] = (
                await this.filterDuplicates(
                    ctx.targetPlaylistTracks,
                    tracksForAdd,
                )
            ).map((newTrack) => newTrack.id as string);

            if (!trackIdsForAdd.length) {
                this.logService.success(
                    `No tracks to add to playlist`,
                    loggerCtx,
                );
                continue;
            }

            await ctx.targetService.addTracksToPlaylist(
                trackIdsForAdd,
                target.metadata,
            );
            this.logService.success(
                `Added ${trackIdsForAdd.length} tracks to ${target.metadata.name} playlist`,
                loggerCtx,
            );
            result.added += trackIdsForAdd.length;
        }

        this.logService.success('Sync completed', loggerCtx);
        return result;
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

    private async findTracksInService(
        ctx: PlaylistSyncContext,
        serviceType: MusicServiceTypes,
        tracks: Track[],
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);
        this.logService.await(
            `Try to find tracks in ${serviceType} service`,
            ctx.loggerCtx,
        );
        const serviceTracks = [];

        for (const track of tracks) {
            const serviceTrack = await service.searchTrackByName(
                track.name,
                track.artists,
            );

            if (!serviceTrack) {
                this.logService.warn(
                    `Track ${track.name} by ${track.artists.join(
                        ', ',
                    )} not found`,
                    ctx.loggerCtx,
                );
                continue;
            }

            serviceTracks.push(serviceTrack);
        }

        return serviceTracks;
    }

    private async filterDuplicates(
        playlistTracks: Track[],
        tracksToAdd: Track[],
    ): Promise<Track[]> {
        return tracksToAdd.filter(
            (newTrack) =>
                !playlistTracks.some(
                    (playlistTrack) => playlistTrack.id === newTrack.id,
                ),
        );
    }

    private async removeDeletedTracks(
        ctx: PlaylistSyncContext,
        tracksToAdd: Track[],
    ): Promise<void> {
        if (!ctx.targetService || !ctx.targetPlaylist) {
            return;
        }

        const tracksToRemove =
            ctx.targetPlaylistTracks?.filter(
                (t) => !tracksToAdd.some((ta) => ta.id === t.id),
            ) ?? [];

        if (!tracksToRemove.length) {
            return;
        }

        await ctx.targetService.removeTracksFromPlaylist(
            tracksToRemove,
            ctx.targetPlaylist,
        );
    }
}
