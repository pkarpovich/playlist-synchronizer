import { Track } from '../entities';

export type GetPlaylistTracksOptions = {
    playlistId: string;
    userName?: string;
};

export interface BaseMusicService {
    getPlaylistTracks(options: GetPlaylistTracksOptions): Promise<Track[]>;
}
