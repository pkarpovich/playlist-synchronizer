import { YandexMusicApi } from 'yandex-short-api';

import { Playlist, Track } from '../entities';
import { BaseMusicService } from './base-music.service';

export class YandexMusicService implements BaseMusicService {
    client: YandexMusicApi;

    constructor() {
        this.client = new YandexMusicApi();
    }

    async getPlaylistTracks({ id, userName }: Playlist): Promise<Track[]> {
        const resp = await this.client.getPlaylist(userName as string, id);
        const { tracks } = resp;

        return tracks.map<Track>((track) => ({
            name: track.title,
            artist: track.artists[0].name,
        }));
    }

    searchTrackByName(name: string, artist: string): Promise<Track> {
        throw new Error('Method not implemented.');
    }

    addTracksToPlaylist(trackIds: string[], playlist: Playlist): Promise<void> {
        throw new Error('Method not implemented.');
    }
}
