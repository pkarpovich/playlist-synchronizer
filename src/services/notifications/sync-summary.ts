import { LastRun, PlaylistRunResult, RunStatus } from '../../entities.js';

export type PlaylistLine =
    | { name: string; kind: 'added'; added: number; notFound: number }
    | { name: string; kind: 'failed'; error?: string }
    | { name: string; kind: 'empty-source' };

export type RunSummary = { verdict: RunStatus; lines: PlaylistLine[] };

function toLine(playlist: PlaylistRunResult): PlaylistLine | null {
    if (playlist.status === 'failed') {
        return { name: playlist.name, kind: 'failed', error: playlist.error };
    }

    if (playlist.status === 'empty-source') {
        return { name: playlist.name, kind: 'empty-source' };
    }

    if (playlist.added > 0) {
        return {
            name: playlist.name,
            kind: 'added',
            added: playlist.added,
            notFound: playlist.notFound,
        };
    }

    return null;
}

export function summarizeRun(lastRun: LastRun | null): RunSummary | null {
    if (lastRun === null) {
        return null;
    }

    const lines: PlaylistLine[] = [];

    for (const playlist of lastRun.playlists) {
        const line = toLine(playlist);

        if (line !== null) {
            lines.push(line);
        }
    }

    if (lines.length === 0) {
        return null;
    }

    return { verdict: lastRun.status, lines };
}
