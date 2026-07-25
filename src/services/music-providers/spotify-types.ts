export type SpotifyTrack = {
    uri: string;
    name: string;
    type?: string;
    duration_ms?: number;
    artists: { name: string }[];
    external_ids?: { isrc?: string };
};

export type SpotifyFetchResponse = Pick<Response, 'ok' | 'status' | 'json'> & {
    headers: Pick<Headers, 'get'>;
};

export type SpotifyFetchFn = (
    url: string,
    init?: RequestInit,
) => Promise<SpotifyFetchResponse>;
