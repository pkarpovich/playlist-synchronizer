import { get_option, setup } from 'libmuse';

import { Playlist, Store, Track } from '../../../entities.js';
import { BaseMusicService } from '../base-music.service.js';
import { LogService } from '../../log.service.js';
import { LocalDbService } from '../../local-db.service.js';
import { YoutubeMusicStore } from './youtube-music.store.js';

export class YoutubeMusicService extends BaseMusicService {
    isReady = false;

    constructor(
        private readonly store: LocalDbService<Store>,
        private readonly logService: LogService,
    ) {
        super();
    }

    async initializeClient(): Promise<void> {
        setup({ store: new YoutubeMusicStore(this.store) });

        const isToken = get_option('auth').has_token();
        if (isToken) {
            this.isReady = true;
            return;
        }

        const loginCode = await get_option('auth').get_login_code();
        this.logService.warn(
            `Youtube music login required. Please open this URL in your browser ${loginCode.verification_url} and enter the code: ${loginCode.user_code}`,
        );

        await get_option('auth').load_token_with_code(loginCode);
        this.isReady = true;
    }

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
