import { YandexMusicApi } from 'yandex-short-api';

import { Playlist, Track } from '../../entities.js';
import { BaseMusicService } from './base-music.service.js';
import { LogService } from '../log.service.js';

export class YandexMusicService extends BaseMusicService {
    private client: YandexMusicApi;

    isReady = true;

    constructor(private readonly logService: LogService) {
        super();
        this.client = new YandexMusicApi();
    }

    async getPlaylistTracks({
        id,
        userName,
        name,
    }: Playlist): Promise<Track[]> {
        const resp = await this.client.getPlaylist(userName as string, id);
        if (!resp || !resp.tracks) {
            this.logService.error(
                `Failed to get playlist ${name} from yandex.music`,
            );
            return [];
        }

        const { tracks } = resp;

        return tracks.map<Track>((track) => ({
            name: track.title,
            artists: track.artists.map(({ name }) => name),
            source: track,
        }));
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchTrackByName(name: string, artists: string[]): Promise<Track> {
        throw new Error('Method not implemented.');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addTracksToPlaylist(trackIds: string[], playlist: Playlist): Promise<void> {
        throw new Error('Method not implemented.');
    }

    async removeTracksFromPlaylist(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        tracks: Track[],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        playlist: Playlist,
    ): Promise<void> {
        throw new Error('Method not implemented.');
    }
}
