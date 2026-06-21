import { RunStatus } from '../../entities.js';
import { PlaylistLine, RunSummary } from './sync-summary.js';

const TITLE = '🎵 Playlist Sync';
const DIVIDER = '---';

function renderVerdict(verdict: RunStatus): string {
    if (verdict === 'ok') {
        return '✅ Sync OK';
    }

    if (verdict === 'partial') {
        return '⚠️ Sync partial';
    }

    return '❌ Sync failed';
}

function renderLine(line: PlaylistLine): string {
    if (line.kind === 'added') {
        const suffix =
            line.notFound > 0 ? ` (${line.notFound} not found in Spotify)` : '';

        return `✅ ${line.name}: +${line.added}${suffix}`;
    }

    if (line.kind === 'failed') {
        return `❌ ${line.name}: ${line.error || 'failed'}`;
    }

    return `🕳 ${line.name}: empty source`;
}

export function renderDigest(summary: RunSummary): string {
    const header = [TITLE, DIVIDER, renderVerdict(summary.verdict)];
    const lines = summary.lines.map(renderLine);

    return [...header, '', ...lines].join('\n');
}
