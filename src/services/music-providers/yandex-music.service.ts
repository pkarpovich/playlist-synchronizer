import { YandexMusicApi } from 'yandex-short-api';

import { Playlist, Track } from '../../entities';
import { BaseMusicService } from './base-music.service';
import { LogService } from '../log.service';

export class YandexMusicService extends BaseMusicService {
    private client: YandexMusicApi;

    isReady: boolean = true;

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
        }));
    }

    searchTrackByName(name: string, artists: string[]): Promise<Track> {
        throw new Error('Method not implemented.');
    }

    addTracksToPlaylist(trackIds: string[], playlist: Playlist): Promise<void> {
        throw new Error('Method not implemented.');
    }
}