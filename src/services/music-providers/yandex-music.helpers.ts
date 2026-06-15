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
        tracks?: { track: YandexTrack }[];
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

    return {
        type: 5,
        host: hostname,
        port: Number(port),
    };
}

export function mapPlaylistTracks(json: YandexPlaylistResponse): Track[] {
    const tracks = json.result?.tracks ?? [];

    return tracks.map<Track>(({ track }) => ({
        name: track.title,
        artists: track.artists.map(({ name }) => name),
        source: track,
    }));
}
