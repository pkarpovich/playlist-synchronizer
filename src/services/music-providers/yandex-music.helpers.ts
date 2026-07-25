import { Track } from '../../entities.js';

export type YandexArtist = {
    name: string;
};

export type YandexEntityId = string | number;

export type YandexTrack = {
    id?: YandexEntityId;
    title?: string;
    version?: string;
    durationMs?: number;
    artists?: YandexArtist[];
};

export type YandexPlaylistResponse = {
    result?: {
        tracks?: { id?: YandexEntityId; track?: YandexTrack | null }[];
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

function readEntityId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        return value;
    }

    return null;
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
            const entryId = readEntityId(item.id);

            if (!entryId) {
                throw new Error(
                    'Unexpected Yandex playlist response: an unavailable entry is missing a non-empty "id"',
                );
            }

            return [{ id: entryId, name: '', artists: [], unavailable: true }];
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

        const trackId = readEntityId(track.id);

        if (!trackId) {
            throw new Error(
                'Unexpected Yandex playlist response: track body is missing a non-empty "id"',
            );
        }

        return [
            {
                id: trackId,
                name: track.title,
                ...(typeof track.version === 'string' && track.version.trim()
                    ? { version: track.version }
                    : {}),
                artists: artists.map(({ name }) => name),
                ...(typeof track.durationMs === 'number'
                    ? { durationMs: track.durationMs }
                    : {}),
                source: track,
            },
        ];
    });
}
