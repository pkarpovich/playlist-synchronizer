import { randomBytes } from 'node:crypto';

import { ConfigService } from '../config.service.js';
import { DbService } from '../db.service.js';
import { LogService } from '../log.service.js';
import { IConfig } from '../../config.js';
import {
    classifyTokenResponse,
    readTokenErrorCode,
    SpotifyHttpError,
    SpotifyNotAuthorizedError,
} from './spotify-errors.js';
import { SpotifyFetchFn, SpotifyFetchResponse } from './spotify-types.js';

const AuthServiceName = 'spotify';
const TokenUrl = 'https://accounts.spotify.com/api/token';
const AuthorizeUrl = 'https://accounts.spotify.com/authorize';
const Scopes =
    'playlist-read-private playlist-modify-private playlist-modify-public';
const InvalidGrantCode = 'invalid_grant';
const ExpiryMarginMs = 60000;
const BackoffDelaysMs = [500, 1000, 2000];
const StateBytes = 16;

export type SpotifyAuthState =
    | 'not-authorized'
    | 'authorized'
    | 'needs-reauthorization';

export type DelayFn = (ms: number) => Promise<void>;

type TokenSuccess = {
    accessToken: string;
    expiresInSeconds: number;
    refreshToken: string | null;
};

type TokenAttempt =
    | { kind: 'success'; token: TokenSuccess }
    | { kind: 'fatal'; error: Error }
    | { kind: 'transient'; status: number; reason: string };

function readTokenSuccess(body: unknown): TokenSuccess | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }

    const { access_token, expires_in, refresh_token } = body as {
        access_token?: unknown;
        expires_in?: unknown;
        refresh_token?: unknown;
    };

    if (typeof access_token !== 'string' || !access_token) {
        return null;
    }

    return {
        accessToken: access_token,
        expiresInSeconds: typeof expires_in === 'number' ? expires_in : 0,
        refreshToken:
            typeof refresh_token === 'string' && refresh_token
                ? refresh_token
                : null,
    };
}

async function readJson(response: SpotifyFetchResponse): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export class SpotifyAuthService {
    private authState: SpotifyAuthState = 'not-authorized';

    private accessToken: string | null = null;

    private expiresAt = 0;

    private refreshInFlight: Promise<string> | null = null;

    constructor(
        private readonly dbService: DbService,
        private readonly configService: ConfigService<IConfig>,
        private readonly logService: LogService,
        private readonly fetchFn: SpotifyFetchFn,
        private readonly now: () => number,
        private readonly delayFn: DelayFn,
    ) {}

    get state(): SpotifyAuthState {
        return this.authState;
    }

    get isReady(): boolean {
        return this.authState === 'authorized';
    }

    async initialize(): Promise<void> {
        const record = this.dbService.getAuth(AuthServiceName);
        const refreshToken = record?.refreshToken ?? '';

        if (!refreshToken) {
            this.authState = record?.revokedAt
                ? 'needs-reauthorization'
                : 'not-authorized';
            this.logAuthorizeUrl();
            return;
        }

        try {
            await this.getAccessToken();
            this.logService.success('Spotify access token refreshed');
        } catch (error) {
            if (error instanceof SpotifyNotAuthorizedError) {
                return;
            }

            this.logService.error(
                `Spotify token refresh failed, will retry on the next request: ${String(error)}`,
            );
        }
    }

    async getAccessToken(): Promise<string> {
        if (this.authState === 'needs-reauthorization') {
            throw new SpotifyNotAuthorizedError(
                'Spotify authorization was revoked, re-authorization required',
            );
        }

        if (this.accessToken && this.now() < this.expiresAt) {
            return this.accessToken;
        }

        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }

        this.refreshInFlight = this.performRefresh().finally(() => {
            this.refreshInFlight = null;
        });

        return this.refreshInFlight;
    }

    async exchangeCode(code: string, state: string | null): Promise<void> {
        const pendingState =
            this.dbService.getAuth(AuthServiceName)?.pendingState ?? null;

        if (!state || !pendingState || state !== pendingState) {
            throw new Error(
                'Spotify authorization state does not match a pending authorization request',
            );
        }

        const token = await this.postToken(
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.configService.get('spotify.redirectUri'),
            }),
        );

        this.acceptToken(token);
        this.dbService.setRevokedAt(AuthServiceName, null);
        this.dbService.setPendingState(AuthServiceName, null);
        this.logService.success('Spotify authorization completed');
    }

    buildAuthorizeUrl(): string {
        const state = randomBytes(StateBytes).toString('hex');
        this.dbService.setPendingState(AuthServiceName, state);

        const params = new URLSearchParams({
            client_id: this.configService.get('spotify.clientId'),
            response_type: 'code',
            redirect_uri: this.configService.get('spotify.redirectUri'),
            scope: Scopes,
            state,
        });

        return `${AuthorizeUrl}?${params.toString()}`;
    }

    private logAuthorizeUrl(): void {
        this.logService.warn(
            `Spotify authorization required. Open this URL in a browser: ${this.buildAuthorizeUrl()}`,
        );
    }

    private async performRefresh(): Promise<string> {
        const refreshToken =
            this.dbService.getAuth(AuthServiceName)?.refreshToken ?? '';

        if (!refreshToken) {
            throw new SpotifyNotAuthorizedError(
                'Spotify refresh token is missing, authorization required',
            );
        }

        try {
            const token = await this.postToken(
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken,
                }),
            );

            this.acceptToken(token);
            return token.accessToken;
        } catch (error) {
            if (
                error instanceof SpotifyHttpError &&
                error.code === InvalidGrantCode
            ) {
                this.discardToken();
                throw new SpotifyNotAuthorizedError(
                    'Spotify refused the refresh token, re-authorization required',
                );
            }

            throw error;
        }
    }

    private acceptToken(token: TokenSuccess): void {
        if (token.refreshToken) {
            this.dbService.setRefreshToken(AuthServiceName, token.refreshToken);
        }

        this.accessToken = token.accessToken;
        this.expiresAt =
            this.now() + token.expiresInSeconds * 1000 - ExpiryMarginMs;
        this.authState = 'authorized';
    }

    private discardToken(): void {
        this.dbService.setRefreshToken(AuthServiceName, '');
        this.dbService.setRevokedAt(AuthServiceName, this.now());
        this.accessToken = null;
        this.expiresAt = 0;
        this.authState = 'needs-reauthorization';
        this.logAuthorizeUrl();
    }

    private async postToken(params: URLSearchParams): Promise<TokenSuccess> {
        let lastStatus = 0;
        let lastReason = 'no attempt was made';

        for (let attempt = 0; attempt < BackoffDelaysMs.length; attempt += 1) {
            const outcome = await this.attemptToken(params);

            if (outcome.kind === 'success') {
                return outcome.token;
            }

            if (outcome.kind === 'fatal') {
                throw outcome.error;
            }

            lastStatus = outcome.status;
            lastReason = outcome.reason;
            await this.delayFn(BackoffDelaysMs[attempt]);
        }

        throw new SpotifyHttpError(
            `Spotify token request failed after ${BackoffDelaysMs.length} attempts: ${lastReason}`,
            lastStatus,
        );
    }

    private async attemptToken(params: URLSearchParams): Promise<TokenAttempt> {
        let response: SpotifyFetchResponse;

        try {
            response = await this.fetchFn(TokenUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.basicAuth()}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params.toString(),
            });
        } catch (error) {
            return { kind: 'transient', status: 0, reason: String(error) };
        }

        const body = await readJson(response);

        if (response.ok) {
            const token = readTokenSuccess(body);
            if (!token) {
                return {
                    kind: 'fatal',
                    error: new SpotifyHttpError(
                        'Spotify token response carried no access token',
                        response.status,
                    ),
                };
            }

            return { kind: 'success', token };
        }

        const code = readTokenErrorCode(body);
        const classification = classifyTokenResponse(response.status, body);

        if (classification === 'transient') {
            return {
                kind: 'transient',
                status: response.status,
                reason: `HTTP ${response.status}`,
            };
        }

        return {
            kind: 'fatal',
            error: new SpotifyHttpError(
                `Spotify token request rejected with ${code ?? 'an unknown error'}`,
                response.status,
                code,
            ),
        };
    }

    private basicAuth(): string {
        const clientId: string = this.configService.get('spotify.clientId');
        const clientSecret: string = this.configService.get(
            'spotify.clientSecret',
        );

        return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }
}
