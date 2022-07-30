import SpotifyClient from 'spotify-web-api-node';

import { LocalDbService } from './local-db.service';
import { AuthStore, Playlist, Track } from '../entities';
import { ConfigService } from './config.service';
import { IConfig } from '../config';
import { BaseMusicService } from './base-music.service';

const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-read-private',
    'playlist-modify-private',
    'playlist-modify-public',
];

export class SpotifyService implements BaseMusicService {
    private client: SpotifyClient;

    constructor(
        private readonly authStore: LocalDbService<AuthStore>,
        private readonly configService: ConfigService<IConfig>,
    ) {
        this.client = new SpotifyClient({
            clientId: configService.get('spotify.clientId'),
            clientSecret: configService.get('spotify.clientSecret'),
            redirectUri: configService.get('spotify.redirectUri'),
        });

        this.initializeClient();
    }

    async initializeClient(): Promise<void> {
        await this.authStore.start();
        const { refreshToken } = this.authStore.get();

        if (!refreshToken) {
            const url = this.client.createAuthorizeURL(scopes, 'spotify-app');
            console.log(`Please open this URL in your browser: ${url}`);
            return;
        }

        this.client.setRefreshToken(refreshToken);
        await this.refreshAccess();
    }

    async authorizationCodeGrant(code: string): Promise<void> {
        const { body } = await this.client.authorizationCodeGrant(code);

        await this.client.setAccessToken(body.access_token);
        await this.client.setRefreshToken(body.refresh_token);

        await this.authStore.set({ refreshToken: body.refresh_token });
    }

    async refreshAccess(): Promise<void> {
        const { body } = await this.client.refreshAccessToken();

        await this.client.setAccessToken(body.access_token);
    }

    async getPlaylistTracks({ id }: Playlist): Promise<Track[]> {
        const { body } = await this.client.getPlaylistTracks(id);

        return body.items.map<Track>(({ track }) => ({
            id: track?.uri,
            name: track?.name as string,
            artist: track?.artists[0].name as string,
        }));
    }

    async searchTrackByName(
        name: string,
        artist: string,
    ): Promise<Track | null> {
        const { body } = await this.client.search(
            `track:${name} artist:${artist}`,
            ['track'],
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
        await this.client.addTracksToPlaylist(playlist.id, trackIds);
    }
}
