import SpotifyClient from 'spotify-web-api-node';

import { LocalDbService } from '../local-db.service';
import { AuthStore, Playlist, Track } from '../../entities';
import { ConfigService } from '../config.service';
import { IConfig } from '../../config';
import { BaseMusicService } from './base-music.service';
import { retry } from '../../utils/retry';
import { LogService } from '../log.service';

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

    isReady: boolean = false;

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
        const { body } = await retry<
            Response<SpotifyApi.PlaylistTrackResponse>
        >(
            () => this.client.getPlaylistTracks(id),
            () => this.refreshAccess(),
        );

        return body.items.map<Track>(({ track }) => ({
            id: track?.uri,
            name: track?.name as string,
            artist: track?.artists[0].name as string,
        }));
    }

    async searchArtistByName(
        name: string,
    ): Promise<SpotifyApi.ArtistObjectFull | undefined> {
        const { body } = await retry<Response<SpotifyApi.SearchResponse>>(
            () => this.client.searchArtists(name),
            () => this.refreshAccess(),
        );

        return body.artists?.items[0];
    }

    async searchTrackByName(
        name: string,
        artist: string,
    ): Promise<Track | null> {
        const searchQuery = await this.createSearchQuery(name, artist);

        const { body } = await retry<Response<SpotifyApi.SearchResponse>>(
            () => this.client.searchTracks(searchQuery),
            () => this.refreshAccess(),
        );

        const track = body.tracks?.items[0];
        if (!track) {
            return null;
        }

        return {
            id: track.uri,
            name: track.name,
            artist: track.artists[0].name,
        } as Track;
    }

    async addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void> {
        await retry<Response<SpotifyApi.AddTracksToPlaylistResponse>>(
            () => this.client.addTracksToPlaylist(playlist.id, trackIds),
            () => this.refreshAccess(),
        );
    }

    private async createSearchQuery(
        trackName: string,
        artistName: string,
    ): Promise<string> {
        let query = `track:${trackName}`;

        const artist = await this.searchArtistByName(artistName);
        if (artist) {
            query += ` artist:${artist.name}`;
        }

        return query;
    }
}
