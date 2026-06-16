export type PlaylistRunStatus = 'ok' | 'failed' | 'empty-source';

export type PlaylistRunResult = {
    name: string;
    status: PlaylistRunStatus;
    sourceTracks: number;
    matched: number;
    added: number;
    notFound: number;
    error?: string;
};

export type RunStatus = 'ok' | 'partial' | 'failed';

export type LastRun = {
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    status: RunStatus;
    playlists: PlaylistRunResult[];
};

export function computeRunStatus(playlists: PlaylistRunResult[]): RunStatus {
    const okCount = playlists.filter((p) => p.status === 'ok').length;

    if (okCount === playlists.length) {
        return 'ok';
    }

    if (okCount === 0) {
        return 'failed';
    }

    return 'partial';
}
