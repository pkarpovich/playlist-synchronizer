import { YandexMusicApi } from 'yandex-short-api';
import { Track } from '../entities/track.entity';

export class YandexMusicService {
    client: YandexMusicApi;

    constructor() {
        this.client = new YandexMusicApi();
    }

    async getPlaylistTracks(
        userName: string,
        playlistId: string,
    ): Promise<Track[]> {
        const { tracks } = await this.client.getPlaylist(userName, playlistId);

        return tracks.map<Track>((track) => ({
            name: track.title,
            artist: track.artists[0].name,
        }));
    }
}
