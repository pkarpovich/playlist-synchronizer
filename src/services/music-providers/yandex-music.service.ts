import { socksDispatcher } from 'fetch-socks';

import { Playlist, Track } from '../../entities.js';
import { IConfig } from '../../config.js';
import { BaseMusicService } from './base-music.service.js';
import { ConfigService } from '../config.service.js';
import { LogService } from '../log.service.js';
import {
    buildPlaylistUrl,
    mapPlaylistTracks,
    parseSocksProxy,
    YandexPlaylistResponse,
} from './yandex-music.helpers.js';

export type YandexFetchResponse = Pick<Response, 'ok' | 'status' | 'json'>;

export type FetchFn = (
    url: string,
    init?: RequestInit,
) => Promise<YandexFetchResponse>;

export class YandexMusicService extends BaseMusicService {
    isReady = true;

    private dispatcher?: ReturnType<typeof socksDispatcher>;

    constructor(
        private readonly logService: LogService,
        private readonly configService: ConfigService<IConfig>,
        private readonly fetchFn: FetchFn,
    ) {
        super();
    }

    async getPlaylistTracks({ id, userName }: Playlist): Promise<Track[]> {
        const baseUrl = this.configService.get('yandexMusic.baseUrl');
        const proxyUrl = this.configService.get('yandexMusic.proxyUrl');
        const url = buildPlaylistUrl(baseUrl, userName, id);

        const dispatcher = this.getDispatcher(proxyUrl);
        const resp = dispatcher
            ? await this.fetchFn(url, {
                  dispatcher,
              } as unknown as RequestInit)
            : await this.fetchFn(url);

        if (!resp.ok) {
            throw new Error(
                `Failed to fetch Yandex playlist ${userName}/${id} (HTTP ${resp.status})`,
            );
        }

        const json = (await resp.json()) as YandexPlaylistResponse;

        return mapPlaylistTracks(json);
    }

    private getDispatcher(
        proxyUrl: string,
    ): ReturnType<typeof socksDispatcher> | undefined {
        if (!proxyUrl) {
            return undefined;
        }

        if (!this.dispatcher) {
            this.dispatcher = socksDispatcher(parseSocksProxy(proxyUrl));
        }

        return this.dispatcher;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchTrackByName(name: string, artists: string[]): Promise<Track> {
        throw new Error('Method not implemented.');
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
