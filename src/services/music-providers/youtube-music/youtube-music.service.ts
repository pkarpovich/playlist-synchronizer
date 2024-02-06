import {
    add_playlist_items as addPlaylistItems,
    get_option as getOption,
    get_playlist as getPlaylist,
    remove_playlist_items as removePlaylistItemsLibmuseMethode,
    search,
    setup,
} from 'libmuse';
import type { SearchSong } from 'libmuse/types/parsers/search.js';
import type {
    EditPlaylistResult,
    GetPlaylistOptions,
    Playlist as PlaylistLibmuse,
} from 'libmuse/types/mixins/playlist.js';
import type { SongArtist } from 'libmuse/types/parsers/songs.js';
import type {
    SearchOptions,
    SearchResults,
} from 'libmuse/types/mixins/search.js';

import { Playlist, Store, Track } from '../../../entities.js';
import { BaseMusicService } from '../base-music.service.js';
import { LogService } from '../../log.service.js';
import { LocalDbService } from '../../local-db.service.js';
import { YoutubeMusicStore } from './youtube-music.store.js';
import { checkIfArraysAreEqual } from '../../../utils/array.js';
import { retry } from '../../../utils/retry.js';
import { ConfigService } from '../../config.service.js';
import { IConfig } from '../../../config/config.js';

export class YoutubeMusicService extends BaseMusicService {
    isReady = false;
    private getPlaylistTracksLimit = Number.MAX_VALUE;

    private readonly cache = new Map<string, Track>();

    constructor(
        private readonly store: LocalDbService<Store>,
        private readonly configService: ConfigService<IConfig>,
        private readonly logService: LogService,
    ) {
        super();
    }

    async initializeClient(): Promise<void> {
        setup({
            store: new YoutubeMusicStore(this.store),
            location: this.configService.get('location'),
            language: this.configService.get('language'),
        });

        const isToken = getOption('auth').has_token();
        if (isToken) {
            this.isReady = true;
            return;
        }

        const loginCode = await getOption('auth').get_login_code();
        this.logService.warn(
            `Youtube music login required. Please open this URL in your browser ${loginCode.verification_url} and enter the code: ${loginCode.user_code}`,
        );

        await getOption('auth').load_token_with_code(loginCode);
        this.isReady = true;
    }

    async getPlaylistTracks({ id }: Playlist): Promise<Track[]> {
        const playlist = await this.getPlaylist(id, {
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
        const searchQuery = `${name} ${artists}`;
        const trackInCache = this.cache.get(searchQuery);

        if (trackInCache) {
            return trackInCache;
        }

        const searchResult = await this.search(searchQuery, {
            filter: 'songs',
        });

        const findTracks = searchResult.categories.find(
            (sr) => sr.filter === 'songs',
        )?.results as SearchSong[];

        if (!findTracks?.length) {
            return null;
        }

        const track = findTracks.find((track) =>
            this.isTrackMatchingCriteria(
                name,
                artists,
                track.title,
                this.artistsToNameArray(track.artists),
            ),
        );

        if (!track) {
            return null;
        }

        const result = {
            id: track.videoId,
            name: track.title,
            artists: track.artists.map((a) => a.name),
            source: track,
        };
        this.cache.set(searchQuery, result);

        return result;
    }

    async addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void> {
        await retry<PlaylistLibmuse>(
            async () => await addPlaylistItems(playlist.id, trackIds),
            async () => this.logApiError(this.addTracksToPlaylist.name),
        );
    }

    async removeTracksFromPlaylist(
        tracks: Track[],
        playlist: Playlist,
    ): Promise<void> {
        const playlistFromServer: PlaylistLibmuse = await this.getPlaylist(
            playlist.id,
            { limit: this.getPlaylistTracksLimit },
        );

        const trackWithId = tracks.filter((t) => {
            if (t?.id) {
                return true;
            }

            this.logService.warn(
                `Track ${t.name} by ${t.artists} was not removed in youtube. Reason id is absent`,
            );
        });

        const trackFromServer = playlistFromServer.tracks.filter(
            (trackFromServer) =>
                trackWithId.some(
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

        if (!trackFromServerWithSetVideoId.length) {
            return;
        }

        await this.removePlaylistItemsWrapperOverApiMethod(
            playlist.id,
            trackFromServerWithSetVideoId.map((t) => ({
                videoId: t.videoId,
                setVideoId: t.setVideoId as string,
            })),
        );
    }

    private artistsToNameArray(artists: SongArtist[]) {
        let result: string[] = [];

        for (const artist of artists) {
            if (artist.id) {
                result.push(artist.name);
                continue;
            }

            const names = artist.name.replace(/, & | & | and | и /g, ', ');
            result = [...result, ...names.split(', ')];
        }

        return result;
    }

    private isTrackMatchingCriteria(
        findName: string,
        findArtist: string[],
        foundName: string,
        foundArtists: string[],
    ) {
        findName = findName.toLowerCase();
        findArtist = findArtist.map((a) => a.toLowerCase());
        foundName = foundName.toLowerCase();
        foundArtists = foundArtists.map((a) => a.toLowerCase());

        const processedFindName = this.getPrimaryTrackName(findName);
        const processedFoundName = this.getPrimaryTrackName(foundName);

        if (processedFindName !== processedFoundName) {
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

    private getPrimaryTrackName(name: string): string {
        const regex = /\s+\((ft|feat|prod)\./;

        return name.split(regex)[0].trim();
    }

    private async getPlaylist(
        playlistId: string,
        options?: GetPlaylistOptions,
    ): Promise<PlaylistLibmuse> {
        return retry<PlaylistLibmuse>(
            async () => await getPlaylist(playlistId, options),
            async () => this.logApiError(this.getPlaylist.name),
        );
    }

    private async search(
        query: string,
        options?: SearchOptions,
    ): Promise<SearchResults> {
        return retry<SearchResults>(
            async () => await search(query, options),
            async () => this.logApiError(this.search.name),
        );
    }

    private async removePlaylistItemsWrapperOverApiMethod(
        playlistId: string,
        videoIds: {
            videoId: string;
            setVideoId: string;
        }[],
    ): Promise<EditPlaylistResult> {
        return retry<EditPlaylistResult>(
            async () =>
                await removePlaylistItemsLibmuseMethode(playlistId, videoIds),
            async () =>
                this.logApiError(
                    this.removePlaylistItemsWrapperOverApiMethod.name,
                ),
        );
    }

    private logApiError(functionName: string) {
        this.logService.warn(
            `The ${functionName} in the YoutubeMusicService ended with an error. The function will be re-run`,
        );
    }
}
