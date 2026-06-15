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

export function buildPlaylistUrl(
    baseUrl: string,
    owner: string,
    kind: string,
): string {
    return `${baseUrl}/users/${owner}/playlists/${kind}`;
}

export function mapPlaylistTracks(json: YandexPlaylistResponse): Track[] {
    const tracks = json.result?.tracks ?? [];

    return tracks.map<Track>(({ track }) => ({
        name: track.title,
        artists: track.artists.map(({ name }) => name),
        source: track,
    }));
}
