import { SpotifyTrack } from './spotify-types.js';

const COMBINING_MARKS = /\p{M}/gu;
const AMPERSAND = /&/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN = /\s+/g;
const BRACKETED_TAIL = /\s*[([][^()[\]]*[)\]]\s*$/;
const FEAT_TAIL = /\s+(feat|ft)\.?\s+.*$/;
const DASH_SEPARATOR = ' - ';

function foldCase(value: string): string {
    return value.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '');
}

function collapse(value: string): string {
    return value
        .replace(AMPERSAND, ' and ')
        .replace(NON_ALPHANUMERIC, ' ')
        .replace(WHITESPACE_RUN, ' ')
        .trim();
}

function removeDashTail(value: string): string {
    const separatorIndex = value.indexOf(DASH_SEPARATOR);

    if (separatorIndex === -1) {
        return value;
    }

    return value.slice(0, separatorIndex);
}

function stripDecorations(value: string): string {
    let result = value;
    let previous = '';

    while (result !== previous) {
        previous = result;
        result = result.replace(BRACKETED_TAIL, '');
        result = removeDashTail(result);
        result = result.replace(FEAT_TAIL, '');
    }

    return result;
}

export function normalizeTitle(value: string): {
    full: string;
    stripped: string;
} {
    const folded = foldCase(value);
    const full = collapse(folded);
    const stripped = collapse(stripDecorations(folded));

    if (!stripped) {
        return { full, stripped: full };
    }

    return { full, stripped };
}

export function normalizeArtist(value: string): string {
    return collapse(foldCase(value));
}

export function titleMatches(
    candidateName: string,
    sourceName: string,
): boolean {
    const candidate = normalizeTitle(candidateName);
    const source = normalizeTitle(sourceName);

    if (candidate.full === source.full) {
        return true;
    }

    if (candidate.stripped === candidate.full) {
        return false;
    }

    if (source.stripped === source.full) {
        return false;
    }

    return candidate.stripped === source.stripped;
}

export function artistOverlaps(
    candidate: SpotifyTrack,
    sourceArtists: string[],
): boolean {
    const sourceNames = new Set(sourceArtists.map(normalizeArtist));

    return candidate.artists.some((artist) =>
        sourceNames.has(normalizeArtist(artist.name)),
    );
}
