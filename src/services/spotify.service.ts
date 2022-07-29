import SpotifyClient from 'spotify-web-api-node';

import { LocalDbService } from './local-db.service';
import { AuthStore } from '../entities';
import { ConfigService } from './config.service';
import { IConfig } from '../config';

const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
];

export class SpotifyService {
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
    }

    async initializeClient(): Promise<void> {
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

    private async refreshAccess(): Promise<void> {
        const { body } = await this.client.refreshAccessToken();

        await this.client.setAccessToken(body.access_token);
    }
}
