import { YandexMusicApi } from 'yandex-short-api';

import { Track } from '../entities';
import {
    BaseMusicService,
    GetPlaylistTracksOptions,
} from './base-music.service';

export class YandexMusicService implements BaseMusicService {
    client: YandexMusicApi;

    constructor() {
        this.client = new YandexMusicApi();
    }

    async getPlaylistTracks({
        playlistId,
        userName,
    }: GetPlaylistTracksOptions): Promise<Track[]> {
        const resp = await this.client.getPlaylist(
            userName as string,
            playlistId,
        );
        const { tracks } = resp;

        return tracks.map<Track>((track) => ({
            name: track.title,
            artist: track.artists[0].name,
        }));
    }
}
