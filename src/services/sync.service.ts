import { YandexMusicService } from './yandex-music.service';
import { SpotifyService } from './spotify.service';
import { PlaylistConfig } from '../config';
import { MusicServiceTypes, Playlist, Track } from '../entities';
import { BaseMusicService } from './base-music.service';
import { LogService } from './log.service';
import { retry } from '../utils/retry';

export class SyncService {
    constructor(
        private readonly logService: LogService,
        private readonly yandexMusicService: YandexMusicService,
        private readonly spotifyService: SpotifyService,
    ) {}

    async sync(syncConfig: PlaylistConfig): Promise<void> {
        const originalPlaylistTracks = await this.getPlaylistTracks(
            syncConfig.type,
            syncConfig.metadata,
        );

        for (let target of syncConfig.targetPlaylists) {
            const targetMusicService = this.getMusicServiceByType(target.type);
            const tracksForAdding = await this.findTracksInService(
                originalPlaylistTracks,
                target.type,
            );
            this.logService.success(
                `Found ${tracksForAdding.length} tracks in ${target.type} service`,
            );

            const trackIdsForAdd: string[] = (
                await this.filterDuplicates(
                    target.type,
                    target.metadata,
                    tracksForAdding,
                )
            ).map((newTrack) => newTrack.id as string);

            if (!trackIdsForAdd.length) {
                this.logService.success(
                    `No tracks to add in ${target.metadata.name} playlist`,
                );
                continue;
            }

            await targetMusicService.addTracksToPlaylist(
                trackIdsForAdd,
                target.metadata,
            );
            this.logService.success(
                `Added ${trackIdsForAdd.length} tracks to ${target.metadata.name} playlist`,
            );
        }

        this.logService.success('Sync completed');
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
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);

        this.logService.await(
            `Try to get tracks from ${playlistMetadata.name} playlist`,
        );
        const tracks = await service.getPlaylistTracks(playlistMetadata);
        this.logService.success(
            `Found ${tracks.length} tracks in ${playlistMetadata.name} playlist`,
        );

        return tracks;
    }

    private async findTracksInService(
        tracks: Track[],
        serviceType: MusicServiceTypes,
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);
        this.logService.await(`Try to find tracks in ${serviceType} service`);
        const serviceTracks = [];

        for (let track of tracks) {
            const serviceTrack = await retry(
                () => service.searchTrackByName(track.name, track.artist),
                () => service.refreshAccess(),
            );

            if (!serviceTrack) {
                this.logService.warn(
                    `Track ${track.name} by ${track.artist} not found`,
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
    ): Promise<Track[]> {
        const playlistTracks = await this.getPlaylistTracks(
            serviceType,
            playlistMetadata,
        );

        return tracksToAdding.filter(
            (newTrack) =>
                !playlistTracks.some(
                    (playlistTrack) => playlistTrack.id === newTrack.id,
                ),
        );
    }
}
