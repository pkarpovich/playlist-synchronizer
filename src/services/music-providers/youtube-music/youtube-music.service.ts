import { get_option, get_playlist, search, setup } from 'libmuse';

import { Playlist, Store, Track } from '../../../entities.js';
import { BaseMusicService } from '../base-music.service.js';
import { LogService } from '../../log.service.js';
import { LocalDbService } from '../../local-db.service.js';
import { YoutubeMusicStore } from './youtube-music.store.js';
import type { SearchSong } from 'libmuse/types/parsers/search.js';
import { checkIfArraysAreEqual } from '../../../utils/array.js';

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

    async getPlaylistTracks({ id }: Playlist): Promise<Track[]> {
        const playlist = await get_playlist(id);

        return playlist.tracks.map((track) => ({
            id: track.videoId,
            name: track.title,
            artists: track.artists.map((artist) => artist.name),
            source: track,
        }));
    }

    async searchTrackByName(
        name: string,
        artists: string[],
    ): Promise<Track | null> {
        const searchResult = await search(`${name} ${artists}`, {
            filter: 'songs',
        });

        const findTracks = searchResult.categories.find(
            (sr) => sr.filter === 'songs',
        )?.results as SearchSong[];

        if (!findTracks?.length) {
            return null;
        }

        const track = findTracks.find(
            (track) =>
                track.title === name &&
                checkIfArraysAreEqual<string>(
                    artists,
                    track.artists.map((a) => a.name),
                ),
        );

        if (!track) {
            return null;
        }

        return {
            id: track.videoId,
            name: track.title,
            artists: track.artists.map((a) => a.name),
            source: track,
        };
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
