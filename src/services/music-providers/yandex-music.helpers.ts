import { Track } from '../../entities.js';

export type YandexArtist = {
    name: string;
};

export type YandexTrack = {
    id?: string;
    title?: string;
    artists?: YandexArtist[];
};

export type YandexPlaylistResponse = {
    result?: {
        tracks?: { track?: YandexTrack | null }[];
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
    const tracks = json.result?.tracks;

    if (!Array.isArray(tracks)) {
        throw new Error(
            'Unexpected Yandex playlist response: "result.tracks" is missing or not an array',
        );
    }

    return tracks.flatMap<Track>((item) => {
        const track = item.track;

        if (track === null) {
            return [];
        }

        if (track === undefined) {
            throw new Error(
                'Unexpected Yandex playlist response: a track entry is missing its "track" body',
            );
        }

        if (
            typeof track.title !== 'string' ||
            track.title.trim().length === 0
        ) {
            throw new Error(
                'Unexpected Yandex playlist response: track body is missing a non-empty "title"',
            );
        }

        const artists = track.artists ?? [];
        if (
            artists.length === 0 ||
            artists.some(
                ({ name }) =>
                    typeof name !== 'string' || name.trim().length === 0,
            )
        ) {
            throw new Error(
                'Unexpected Yandex playlist response: track is missing non-empty artist names',
            );
        }

        return [
            {
                name: track.title,
                artists: artists.map(({ name }) => name),
                source: track,
            },
        ];
    });
}
