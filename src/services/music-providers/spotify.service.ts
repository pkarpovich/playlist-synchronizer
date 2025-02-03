import SpotifyClient from 'spotify-web-api-node';

import { BaseMusicService } from './base-music.service.js';
import { LocalDbService } from '../local-db.service.js';
import { ConfigService } from '../config.service.js';
import { LogService } from '../log.service.js';
import { AuthStore, Playlist, Track } from '../../entities.js';
import { IConfig } from '../../config.js';
import {
    parseUrlToQueryParams,
    retry,
    splitArrayIntoChunk,
} from '../../utils.js';

const TracksPerRequest = 99;

const scopes = [
    'playlist-read-private',
    'playlist-modify-private',
    'playlist-modify-public',
];

interface Response<T> {
    body: T;
    headers: Record<string, string>;
    statusCode: number;
}

export class SpotifyService implements BaseMusicService {
    private client: SpotifyClient;

    private readonly cache = new Map<string, SpotifyApi.TrackObjectFull>();

    isReady = false;

    constructor(
        private readonly authStore: LocalDbService<AuthStore>,
        private readonly configService: ConfigService<IConfig>,
        private readonly logService: LogService,
    ) {
        this.client = new SpotifyClient({
            clientId: configService.get('spotify.clientId'),
            clientSecret: configService.get('spotify.clientSecret'),
            redirectUri: configService.get('spotify.redirectUri'),
        });
    }

    async initializeClient(): Promise<void> {
        await this.authStore.start();
        const { refreshToken } = this.authStore.get();

        if (!refreshToken) {
            const url = this.client.createAuthorizeURL(scopes, 'spotify-app');
            this.logService.warn(
                `Spotify login required. Please open this URL in your browser: ${url}`,
            );
            return;
        }

        this.client.setRefreshToken(refreshToken);
        await this.refreshAccess();
    }

    async authorizationCodeGrant(code: string): Promise<void> {
        const { body } = await this.client.authorizationCodeGrant(code);

        await this.client.setAccessToken(body.access_token);
        await this.client.setRefreshToken(body.refresh_token);
        this.isReady = true;

        await this.authStore.set({ refreshToken: body.refresh_token });
    }

    async refreshAccess(): Promise<void> {
        const { body } = await this.client.refreshAccessToken();

        await this.client.setAccessToken(body.access_token);
        this.isReady = true;
    }

    async getPlaylistTracks({ id }: Playlist): Promise<Track[]> {
        const items: SpotifyApi.PlaylistTrackObject[] = [];
        let nextPage: string | null = null;

        do {
            const { limit, offset } = nextPage
                ? parseUrlToQueryParams(nextPage)
                : { limit: 100, offset: 0 };

            const resp: Response<SpotifyApi.PlaylistTrackResponse> =
                await retry<Response<SpotifyApi.PlaylistTrackResponse>>(
                    () =>
                        this.client.getPlaylistTracks(id, {
                            limit: Number(limit),
                            offset: Number(offset),
                        }),
                    () => this.refreshAccess(),
                );

            items.push(...resp.body.items);
            nextPage = resp.body.next;
        } while (nextPage);

        const tracks = items.map<Track>(({ track }) => ({
            id: track?.uri,
            name: track?.name as string,
            artists: track?.artists.map(({ name }) => name) as string[],
            source: track,
        }));

        const duplicates = this.findDuplicateTracksInPlaylist(tracks);
        if (duplicates.length === 0) {
            return tracks;
        }

        await this.removeTracksFromPlaylist(duplicates, { id } as Playlist);
        return tracks.filter(
            (t) => duplicates.findIndex((dt) => dt.id === t.id) === -1,
        );
    }

    async searchArtistByName(
        name: string,
    ): Promise<SpotifyApi.ArtistObjectFull | undefined> {
        const { body } = await retry<Response<SpotifyApi.SearchResponse>>(
            () => this.client.searchArtists(name),
            () => this.refreshAccess(),
        );

        return this.tryToFindMostRelevantArtist(body.artists, name);
    }

    async searchTrackByName(
        name: string,
        artists: string[],
    ): Promise<Track | null> {
        let track = null;

        for (const artist of artists) {
            const searchQuery = `${name} ${artist}`;

            if (this.cache.has(searchQuery)) {
                track = this.cache.get(searchQuery);
                break;
            }

            track =
                (await this.searchTrackByQuery(searchQuery)) ||
                (await this.searchTrackByQuery(
                    await this.createAdvancedSearchQuery(name, artist),
                ));

            if (track) {
                this.cache.set(searchQuery, track);
                break;
            }
        }

        if (!track) {
            return null;
        }

        return {
            id: track.uri,
            name: track.name,
            artists: track.artists.map(({ name }) => name),
        } as Track;
    }

    async addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void> {
        const trackIdChunks = splitArrayIntoChunk<string>(
            trackIds,
            TracksPerRequest,
        );

        for (const ids of trackIdChunks) {
            await retry<Response<SpotifyApi.AddTracksToPlaylistResponse>>(
                () => this.client.addTracksToPlaylist(playlist.id, ids),
                () => this.refreshAccess(),
            );
        }
    }

    async removeTracksFromPlaylist(
        tracks: Track[],
        playlist: Playlist,
    ): Promise<void> {
        await retry(
            () =>
                this.client.removeTracksFromPlaylist(
                    playlist.id,
                    tracks.map(
                        (t) => ({ uri: t.id } as SpotifyApi.TrackObjectFull),
                    ),
                ),
            () => this.refreshAccess(),
        );
    }

    private async searchTrackByQuery(
        query: string,
    ): Promise<SpotifyApi.TrackObjectFull | undefined> {
        const { body } = await retry<Response<SpotifyApi.SearchResponse>>(
            () => this.client.searchTracks(query),
            () => this.refreshAccess(),
        );

        return body.tracks?.items[0];
    }

    private async createAdvancedSearchQuery(
        trackName: string,
        artistName: string,
    ): Promise<string> {
        let query = trackName;

        const artist = await this.searchArtistByName(artistName);
        if (artist) {
            query += ` ${artist.name}`;
        }

        return query;
    }

    private tryToFindMostRelevantArtist(
        artists:
            | SpotifyApi.PagingObject<SpotifyApi.ArtistObjectFull>
            | undefined,
        originalName: string,
    ): SpotifyApi.ArtistObjectFull | undefined {
        const mostRelevantBySearch = artists?.items[0];
        const artistWithSameName = artists?.items.find(
            (artist) => artist.name === originalName,
        );

        if (mostRelevantBySearch && artistWithSameName) {
            return mostRelevantBySearch.popularity >
                artistWithSameName.popularity &&
                mostRelevantBySearch.followers.total >
                    artistWithSameName.followers.total
                ? mostRelevantBySearch
                : artistWithSameName;
        }

        return mostRelevantBySearch;
    }

    private findDuplicateTracksInPlaylist(tracks: Track[]): Track[] {
        return tracks.filter(
            (track, index) =>
                tracks.findIndex((t) => t.id === track.id) !== index,
        );
    }
}
