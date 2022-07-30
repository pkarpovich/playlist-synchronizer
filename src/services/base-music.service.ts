import { Playlist, Track } from '../entities';

export interface BaseMusicService {
    refreshAccess(): Promise<void>;
    getPlaylistTracks(options: Playlist): Promise<Track[]>;
    searchTrackByName(name: string, artist: string): Promise<Track | null>;
    addTracksToPlaylist(trackIds: string[], playlist: Playlist): Promise<void>;
}
