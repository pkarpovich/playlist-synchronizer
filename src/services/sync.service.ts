import { ConfigService } from './config.service';
import { YandexMusicService } from './yandex-music.service';
import { SpotifyService } from './spotify.service';
import { PlaylistConfig } from '../config';
import { MusicServiceTypes, Playlist, Track } from '../entities';
import { BaseMusicService } from './base-music.service';

export class SyncService {
    constructor(
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

            const trackIdsForAdd: string[] = (
                await this.filterDuplicates(
                    target.type,
                    target.metadata,
                    tracksForAdding,
                )
            ).map((newTrack) => newTrack.id as string);

            if (!trackIdsForAdd.length) {
                return;
            }

            await targetMusicService.addTracksToPlaylist(
                trackIdsForAdd,
                target.metadata,
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
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);

        return service.getPlaylistTracks(playlistMetadata);
    }

    private async findTracksInService(
        tracks: Track[],
        serviceType: MusicServiceTypes,
    ): Promise<Track[]> {
        const service = this.getMusicServiceByType(serviceType);

        return Promise.all(
            tracks.map((track) =>
                service.searchTrackByName(track.name, track.artist),
            ),
        );
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
