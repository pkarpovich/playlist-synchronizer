import { YandexMusicService } from './music-providers/yandex-music.service';
import { BaseMusicService } from './music-providers/base-music.service';
import { SpotifyService } from './music-providers/spotify.service';
import { LoggerContext, LogService } from './log.service';
import { PlaylistConfig } from '../config';
import { MusicServiceTypes, Playlist, Track } from '../entities';

export class SyncService {
    constructor(
        private readonly logService: LogService,
        private readonly yandexMusicService: YandexMusicService,
        private readonly spotifyService: SpotifyService,
    ) {}

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

        for (let target of syncConfig.targetPlaylists) {
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

        for (let track of tracks) {
            const serviceTrack = await service.searchTrackByName(
                track.name,
                track.artist,
            );

            if (!serviceTrack) {
                this.logService.warn(
                    `Track ${track.name} by ${track.artist} not found`,
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

        return tracksToAdding.filter(
            (newTrack) =>
                !playlistTracks.some(
                    (playlistTrack) => playlistTrack.id === newTrack.id,
                ),
        );
    }
}
