export type SyncStatistics = {
    notFoundTracks: number;

    lastSyncAt?: number | null;

    newTracks: number;

    totalTracksInOriginalPlaylists: number;

    totalTracksInTargetPlaylists: number;
};
