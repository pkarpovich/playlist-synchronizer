import { YandexMusicService } from './music-providers/yandex-music.service.js';
import { BaseMusicService } from './music-providers/base-music.service.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { LoggerContext, LogService } from './log.service.js';
import { PlaylistConfig } from '../config.js';
import {
    MusicServiceTypes,
    Playlist,
    Track,
    SyncStatistics,
} from '../entities.js';
import { YoutubeMusicService } from './music-providers/youtube-music/youtube-music.service.js';

const DefaultStatistics: SyncStatistics = {
    lastSyncAt: null,
    newTracks: 0,
    notFoundTracks: 0,
    totalTracksInOriginalPlaylists: 0,
    totalTracksInTargetPlaylists: 0,
};

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
    private _statistics: SyncStatistics;

    get statistics(): SyncStatistics {
        return this._statistics;
    }

    constructor(
        private readonly logService: LogService,
        private readonly yandexMusicService: YandexMusicService,
        private readonly youtubeMusicService: YoutubeMusicService,
        private readonly spotifyService: SpotifyService,
    ) {
        this._statistics = DefaultStatistics;
    }

    resetStatistics(): void {
        this._statistics = DefaultStatistics;
    }

    isAllServicesReady(): boolean {
        return [
            this.yandexMusicService,
            this.spotifyService,
            this.youtubeMusicService,
        ].every((service) => service.isReady);
    }

    async sync(
        syncConfig: PlaylistConfig,
        loggerCtx: LoggerContext,
    ): Promise<void> {
        const isAllServicesReady = this.isAllServicesReady();
        if (!isAllServicesReady) {
            this.logService.await(
                `Skip sync. Wait for all services to be ready`,
            );
            return;
        }

        const sourcePlaylistTracks = await this.getPlaylistTracks(
            syncConfig.type,
            syncConfig.metadata,
            loggerCtx,
        );

        if (!sourcePlaylistTracks.length) {
            return;
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
            this._statistics.totalTracksInOriginalPlaylists +=
                tracksForAdd.length;

            this._statistics.totalTracksInTargetPlaylists +=
                ctx.targetPlaylistTracks.length;

            if (!target?.hasUnavailableTracks) {
                await this.removeDeletedTracks(ctx, tracksForAdd);
            }

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
            this._statistics.newTracks += trackIdsForAdd.length;
            this._statistics.totalTracksInTargetPlaylists +=
                trackIdsForAdd.length;
        }

        this.logService.success('Sync completed', loggerCtx);
    }

    private getMusicServiceByType(type: MusicServiceTypes): BaseMusicService {
        switch (type) {
            case MusicServiceTypes.SPOTIFY: {
                return this.spotifyService;
            }
            case MusicServiceTypes.YANDEX_MUSIC: {
                return this.yandexMusicService;
            }
            case MusicServiceTypes.YOUTUBE_MUSIC: {
                return this.youtubeMusicService;
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
                this._statistics.notFoundTracks++;
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
