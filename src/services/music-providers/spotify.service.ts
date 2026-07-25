import { BaseMusicService } from './base-music.service.js';
import { LogService } from '../log.service.js';
import { Playlist, Track } from '../../entities.js';
import { DelayFn, SpotifyAuthService } from './spotify-auth.service.js';
import {
    classifyApiStatus,
    parseRetryAfter,
    SpotifyHttpError,
} from './spotify-errors.js';
import { artistOverlaps, titleMatches } from './spotify-match.helpers.js';
import {
    SpotifyFetchFn,
    SpotifyFetchResponse,
    SpotifyTrack,
} from './spotify-types.js';

const ApiBaseUrl = 'https://api.spotify.com/v1';
const PageLimit = 50;
const SearchLimit = 10;
const MutationChunkSize = 100;
const BackoffDelaysMs = [500, 1000, 2000];
const MaxRateLimitRetries = 2;

export type SpotifyResolvedTrack = {
    uri: string;
    isrc: string | null;
    durationMs: number | null;
};

type PlaylistItemEntry = {
    is_local?: boolean;
    item: SpotifyTrack | null;
};

type PlaylistItemsPage = {
    items?: PlaylistItemEntry[];
    next?: string | null;
};

type SearchPage = {
    tracks?: { items?: SpotifyTrack[] };
};

type RequestOutcome =
    | { kind: 'done'; body: unknown }
    | { kind: 'fatal'; error: Error }
    | { kind: 'refresh' }
    | { kind: 'retry-after'; status: number; delayMs: number }
    | { kind: 'backoff'; status: number; reason: string };

function toTrack(entry: PlaylistItemEntry): Track | null {
    if (entry.is_local) {
        return null;
    }

    const { item } = entry;
    if (!item?.uri) {
        return null;
    }

    if (item.type && item.type !== 'track') {
        return null;
    }

    return {
        id: item.uri,
        name: item.name,
        artists: (item.artists ?? []).map(({ name }) => name),
    };
}

function toResolvedTrack(track: SpotifyTrack): SpotifyResolvedTrack {
    return {
        uri: track.uri,
        isrc: track.external_ids?.isrc ?? null,
        durationMs: track.duration_ms ?? null,
    };
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

async function readJson(response: SpotifyFetchResponse): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export class SpotifyService implements BaseMusicService {
    constructor(
        private readonly spotifyAuthService: SpotifyAuthService,
        private readonly logService: LogService,
        private readonly fetchFn: SpotifyFetchFn,
        private readonly delayFn: DelayFn,
    ) {}

    get isReady(): boolean {
        return this.spotifyAuthService.isReady;
    }

    async initializeClient(): Promise<void> {
        await this.spotifyAuthService.initialize();
    }

    async authorizationCodeGrant(
        code: string,
        state: string | null = null,
    ): Promise<void> {
        await this.spotifyAuthService.exchangeCode(code, state);
    }

    async getPlaylistTracks({ id }: Playlist): Promise<Track[]> {
        const tracks: Track[] = [];
        const seen = new Set<string>();

        let url: string | null =
            `${ApiBaseUrl}/playlists/${id}/items?limit=${PageLimit}&offset=0`;

        while (url) {
            const page = (await this.request(url)) as PlaylistItemsPage | null;
            if (!page) {
                break;
            }

            for (const entry of page.items ?? []) {
                const track = toTrack(entry);
                if (!track?.id || seen.has(track.id)) {
                    continue;
                }

                seen.add(track.id);
                tracks.push(track);
            }

            url = page.next ?? null;
        }

        return tracks;
    }

    async resolveTrack({
        name,
        artists,
    }: Track): Promise<SpotifyResolvedTrack | null> {
        const [firstArtist = ''] = artists;

        const filtered = await this.search(
            `track:"${name}" artist:"${firstArtist}"`,
        );
        const byFilter = filtered.find((candidate) =>
            titleMatches(candidate.name, name),
        );

        if (byFilter) {
            return toResolvedTrack(byFilter);
        }

        const freeText = await this.search(`${name} ${firstArtist}`);
        const byFreeText = freeText.find(
            (candidate) =>
                titleMatches(candidate.name, name) &&
                artistOverlaps(candidate, artists),
        );

        if (!byFreeText) {
            return null;
        }

        return toResolvedTrack(byFreeText);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchTrackByName(name: string, artists: string[]): Promise<Track | null> {
        throw new Error('Method not implemented.');
    }

    async addTracksToPlaylist(
        trackIds: string[],
        { id }: Playlist,
    ): Promise<void> {
        for (const uris of chunk(trackIds, MutationChunkSize)) {
            await this.request(`${ApiBaseUrl}/playlists/${id}/items`, {
                method: 'POST',
                body: JSON.stringify({ uris }),
            });
        }
    }

    async removeTracksFromPlaylist(
        tracks: Track[],
        { id }: Playlist,
    ): Promise<void> {
        const uris = tracks
            .map(({ id: uri }) => uri)
            .filter((uri): uri is string => Boolean(uri));

        for (const batch of chunk(uris, MutationChunkSize)) {
            await this.request(`${ApiBaseUrl}/playlists/${id}/items`, {
                method: 'DELETE',
                body: JSON.stringify({
                    items: batch.map((uri) => ({ uri })),
                }),
            });
        }
    }

    private async search(query: string): Promise<SpotifyTrack[]> {
        const params = new URLSearchParams({
            q: query,
            type: 'track',
            limit: String(SearchLimit),
        });

        const page = (await this.request(
            `${ApiBaseUrl}/search?${params.toString()}`,
        )) as SearchPage | null;

        return page?.tracks?.items ?? [];
    }

    private async request(
        url: string,
        init: RequestInit = {},
    ): Promise<unknown> {
        let refreshUsed = false;
        let rateLimitRetries = 0;
        let attempt = 0;
        let lastStatus = 0;
        let lastReason = 'no attempt was made';

        while (attempt < BackoffDelaysMs.length) {
            const token = await this.spotifyAuthService.getAccessToken();
            const outcome = await this.attempt(url, init, token);

            if (outcome.kind === 'done') {
                return outcome.body;
            }

            if (outcome.kind === 'fatal') {
                throw outcome.error;
            }

            if (outcome.kind === 'refresh') {
                if (refreshUsed) {
                    throw new SpotifyHttpError(
                        `Spotify rejected the access token for ${url}`,
                        401,
                    );
                }

                refreshUsed = true;
                await this.spotifyAuthService.refreshAccessToken();
                continue;
            }

            if (outcome.kind === 'retry-after') {
                if (rateLimitRetries === MaxRateLimitRetries) {
                    throw new SpotifyHttpError(
                        `Spotify kept rate limiting ${url}`,
                        outcome.status,
                    );
                }

                rateLimitRetries += 1;
                lastStatus = outcome.status;
                lastReason = `HTTP ${outcome.status}`;
                this.logService.warn(
                    `Spotify rate limited ${url}, waiting ${outcome.delayMs}ms`,
                );
                await this.delayFn(outcome.delayMs);
                attempt += 1;
                continue;
            }

            lastStatus = outcome.status;
            lastReason = outcome.reason;
            this.logService.warn(
                `Spotify request to ${url} failed (${outcome.reason}), retrying`,
            );
            await this.delayFn(BackoffDelaysMs[attempt]);
            attempt += 1;
        }

        throw new SpotifyHttpError(
            `Spotify request to ${url} failed after ${BackoffDelaysMs.length} attempts: ${lastReason}`,
            lastStatus,
        );
    }

    private async attempt(
        url: string,
        init: RequestInit,
        token: string,
    ): Promise<RequestOutcome> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
        };

        if (init.body) {
            headers['Content-Type'] = 'application/json';
        }

        let response: SpotifyFetchResponse;

        try {
            response = await this.fetchFn(url, { ...init, headers });
        } catch (error) {
            return { kind: 'backoff', status: 0, reason: String(error) };
        }

        if (response.ok) {
            if (response.status === 204) {
                return { kind: 'done', body: null };
            }

            return { kind: 'done', body: await readJson(response) };
        }

        const action = classifyApiStatus(response.status);

        if (action === 'refresh-retry') {
            return { kind: 'refresh' };
        }

        if (action === 'retry-after') {
            return {
                kind: 'retry-after',
                status: response.status,
                delayMs: parseRetryAfter(response.headers.get('retry-after')),
            };
        }

        if (action === 'backoff') {
            return {
                kind: 'backoff',
                status: response.status,
                reason: `HTTP ${response.status}`,
            };
        }

        return {
            kind: 'fatal',
            error: new SpotifyHttpError(
                `Spotify request to ${url} failed with HTTP ${response.status}`,
                response.status,
            ),
        };
    }
}
