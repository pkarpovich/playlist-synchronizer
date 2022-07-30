import { Playlist, Track } from '../entities';

export interface BaseMusicService {
    getPlaylistTracks(options: Playlist): Promise<Track[]>;
    searchTrackByName(name: string, artist: string): Promise<Track>;
    addTracksToPlaylist(trackIds: string[], playlist: Playlist): Promise<void>;
}
