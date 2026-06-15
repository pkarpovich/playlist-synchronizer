import { Track } from '../../entities.js';

export type YandexArtist = {
    name: string;
};

export type YandexTrack = {
    id?: string;
    title: string;
    artists: YandexArtist[];
};

export type YandexPlaylistResponse = {
    result?: {
        tracks?: { track: YandexTrack | null }[];
    };
};

export type SocksProxyConfig = {
    type: 5;
    host: string;
    port: number;
};

export function buildPlaylistUrl(
    baseUrl: string,
    owner: string,
    kind: string,
): string {
    return `${baseUrl}/users/${owner}/playlists/${kind}`;
}

export function parseSocksProxy(proxyUrl: string): SocksProxyConfig {
    const { hostname, port } = new URL(proxyUrl);
    const portNumber = Number(port);

    if (!hostname || !Number.isInteger(portNumber) || portNumber <= 0) {
        throw new Error(`Invalid YANDEX_API_PROXY: ${proxyUrl}`);
    }

    return {
        type: 5,
        host: hostname,
        port: portNumber,
    };
}

export function mapPlaylistTracks(json: YandexPlaylistResponse): Track[] {
    const tracks = json.result?.tracks ?? [];

    return tracks
        .filter((item): item is { track: YandexTrack } => item.track != null)
        .map<Track>(({ track }) => ({
            name: track.title,
            artists: track.artists.map(({ name }) => name),
            source: track,
        }));
}
