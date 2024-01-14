import {
    add_playlist_items,
    get_option,
    get_playlist,
    remove_playlist_items,
    search,
    setup,
} from 'libmuse';

import { Playlist, Store, Track } from '../../../entities.js';
import { BaseMusicService } from '../base-music.service.js';
import { LogService } from '../../log.service.js';
import { LocalDbService } from '../../local-db.service.js';
import { YoutubeMusicStore } from './youtube-music.store.js';
import type { SearchSong } from 'libmuse/types/parsers/search.js';
import type { Playlist as PlaylistLibmuse } from 'libmuse/types/mixins/playlist.js';
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

    async addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void> {
        await add_playlist_items(playlist.id, trackIds);
    }

    async removeTracksFromPlaylist(
        tracks: Track[],
        playlist: Playlist,
    ): Promise<void> {
        const playlistFromServer: PlaylistLibmuse = await get_playlist(
            playlist.id,
        );

        const trackFromServer = playlistFromServer.tracks.filter(
            (trackFromServer) =>
                tracks.some(
                    (propsTrack) => propsTrack.id === trackFromServer.videoId,
                ),
        );

        const trackFromServerWithSetVideoId = trackFromServer.filter((t) => {
            if (t.setVideoId) {
                return true;
            }

            this.logService.warn(
                `Track ${t.title} by ${t.artists} was not removed in youtube. Reason setVideoId is absent`,
            );
        });

        await remove_playlist_items(
            playlist.id,
            trackFromServerWithSetVideoId.map((t) => ({
                videoId: t.videoId,
                setVideoId: t.setVideoId as string,
            })),
        );
    }
}
