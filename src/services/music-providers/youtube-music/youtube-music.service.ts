import { setup } from 'libmuse';

import { Playlist, Store, Track } from '../../../entities';
import { BaseMusicService } from '../base-music.service';
import { LogService } from '../../log.service';
import { LocalDbService } from '../../local-db.service';
import { YoutubeMusicStore } from './youtube-music.store';

export class YoutubeMusicService extends BaseMusicService {
    isReady = true;

    constructor(
        private readonly store: LocalDbService<Store>,
        private readonly logService: LogService,
    ) {
        super();

        setup({ store: new YoutubeMusicStore(store) });
    }

    async initializeClient(): Promise<void> {}

    async getPlaylistTracks({
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        id,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        userName,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        name,
    }: Playlist): Promise<Track[]> {
        throw new Error('Method not implemented.');
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
