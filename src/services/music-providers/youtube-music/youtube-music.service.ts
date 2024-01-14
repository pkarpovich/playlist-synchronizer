import {
    add_playlist_items,
    get_option,
    get_playlist,
    remove_playlist_items,
    search,
    setup,
} from 'libmuse';
import type { SearchSong } from 'libmuse/types/parsers/search.js';
import type { Playlist as PlaylistLibmuse } from 'libmuse/types/mixins/playlist.js';
import type { SongArtist } from 'libmuse/types/parsers/songs';

import { Playlist, Store, Track } from '../../../entities.js';
import { BaseMusicService } from '../base-music.service.js';
import { LogService } from '../../log.service.js';
import { LocalDbService } from '../../local-db.service.js';
import { YoutubeMusicStore } from './youtube-music.store.js';
import { checkIfArraysAreEqual } from '../../../utils/array.js';

export class YoutubeMusicService extends BaseMusicService {
    isReady = false;
    private getPlaylistTracksLimit = 99999999999;

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
        const playlist = await get_playlist(id, {
            limit: this.getPlaylistTracksLimit,
        });

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

        const track = findTracks.find((track) =>
            this.checkThatTrackIsSuitable(
                name,
                artists,
                track.title,
                this.artistsToNameArray(track.artists),
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

    private artistsToNameArray(artists: SongArtist[]) {
        let result: string[] = [];

        for (const artist of artists) {
            if (artist.id) {
                result.push(artist.name);
                continue;
            }

            const names = artist.name.replace(/, & | & /g, ', ');
            result = [...result, ...names.split(', ')];
        }

        return result;
    }

    private checkThatTrackIsSuitable(
        findName: string,
        findArtist: string[],
        foundName: string,
        foundArtists: string[],
    ) {
        findName = findName.toLowerCase();
        findArtist = findArtist.map((a) => a.toLowerCase());
        foundName = foundName.toLowerCase();
        foundArtists = foundArtists.map((a) => a.toLowerCase());

        const [foundNameWithoutFeaturing] = findName
            .split(' (ft.')[0]
            .split(' (feat.');

        const isNameAppropriate =
            foundName.indexOf(foundNameWithoutFeaturing) !== -1;
        if (!isNameAppropriate) {
            return false;
        }

        const featuringArtists = findArtist.filter(
            (a) => foundName.indexOf(a) !== -1,
        );

        const allFoundArtists = [
            ...new Set([...foundArtists, ...featuringArtists]),
        ];
        return checkIfArraysAreEqual<string>(findArtist, allFoundArtists);
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
            { limit: this.getPlaylistTracksLimit },
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
