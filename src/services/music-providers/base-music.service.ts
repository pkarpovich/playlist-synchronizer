import { Playlist, Track } from '../../entities.js';

interface IBaseMusicService {
    getPlaylistTracks(options: Playlist): Promise<Track[]>;
    searchTrackByName(name: string, artists: string[]): Promise<Track | null>;
    addTracksToPlaylist(trackIds: string[], playlist: Playlist): Promise<void>;
}

export abstract class BaseMusicService implements IBaseMusicService {
    abstract getPlaylistTracks(options: Playlist): Promise<Track[]>;
    abstract searchTrackByName(
        name: string,
        artists: string[],
    ): Promise<Track | null>;
    abstract addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void>;
    abstract removeTracksFromPlaylist(
        tracks: Track[],
        playlist: Playlist,
    ): Promise<void>;

    abstract isReady: boolean;
}
