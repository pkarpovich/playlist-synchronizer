import { Playlist, Track } from '../../entities.js';

export abstract class BaseMusicService {
    abstract getPlaylistTracks(options: Playlist): Promise<Track[]>;
    abstract getPlaylistTrackUris(options: Playlist): Promise<string[]>;
    abstract addTracksToPlaylist(
        trackIds: string[],
        playlist: Playlist,
    ): Promise<void>;
    abstract removeTracksFromPlaylist(
        uris: string[],
        playlist: Playlist,
    ): Promise<void>;

    abstract isReady: boolean;
}
