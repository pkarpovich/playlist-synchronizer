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

const DefaultStatistics: SyncStatistics = {
    lastSyncAt: null,
    newTracks: 0,
    notFoundTracks: 0,
    totalTracksInOriginalPlaylists: 0,
    totalTracksInTargetPlaylists: 0,
};

export class SyncService {
    private _statistics: SyncStatistics;

    get statistics(): SyncStatistics {
        return this._statistics;
    }

    constructor(
        private readonly logService: LogService,
        private readonly yandexMusicService: YandexMusicService,
        private readonly spotifyService: SpotifyService,
    ) {
        this._statistics = DefaultStatistics;
    }

    resetStatistics(): void {
        this._statistics = DefaultStatistics;
    }

    isAllServicesReady(): boolean {
        return [this.yandexMusicService, this.spotifyService].every(
            (service) => service.isReady,
        );
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

        const originalPlaylistTracks = await this.getPlaylistTracks(
            syncConfig.type,
            syncConfig.metadata,
            loggerCtx,
        );

        for (const target of syncConfig.targetPlaylists) {
            const targetMusicService = this.getMusicServiceByType(target.type);
            const tracksForAdding = await this.findTracksInService(
                originalPlaylistTracks,
                target.type,
                loggerCtx,
            );
            this.logService.success(
                `Found ${tracksForAdding.length} tracks in ${target.type} service`,
                loggerCtx,
            );
            this._statistics.totalTracksInOriginalPlaylists +=
                tracksForAdding.length;

            const trackIdsForAdd: string[] = (
                await this.filterDuplicates(
                    target.type,
                    target.metadata,
                    tracksForAdding,
                    loggerCtx,
                )
            ).map((newTrack) => newTrack.id as string);

            if (!trackIdsForAdd.length) {
                this.logService.success(
                    `No tracks to add to playlist`,
                    loggerCtx,
                );
                continue;
            }

            await targetMusicService.addTracksToPlaylist(
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
        tracks: Track[],
        serviceType: MusicServiceTypes,
        loggerCtx: LoggerContext,
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);
        this.logService.await(
            `Try to find tracks in ${serviceType} service`,
            loggerCtx,
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
                    loggerCtx,
                );
                continue;
            }

            serviceTracks.push(serviceTrack);
        }

        return serviceTracks;
    }

    private async filterDuplicates(
        serviceType: MusicServiceTypes,
        playlistMetadata: Playlist,
        tracksToAdding: Track[],
        loggerCtx: LoggerContext,
    ): Promise<Track[]> {
        const playlistTracks = await this.getPlaylistTracks(
            serviceType,
            playlistMetadata,
            loggerCtx,
        );

        this._statistics.totalTracksInTargetPlaylists += playlistTracks.length;

        return tracksToAdding.filter(
            (newTrack) =>
                !playlistTracks.some(
                    (playlistTrack) => playlistTrack.id === newTrack.id,
                ),
        );
    }
}
