import { Track } from '../../entities.js';
import { SpotifyTrack } from './spotify-types.js';

const COMBINING_MARKS = /\p{M}/gu;
const AMPERSAND = /&/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE_RUN = /\s+/g;
const BRACKETED_TAIL = /\s*[([][^()[\]]*[)\]]\s*$/;
const FEAT_TAIL = /\s+(feat|ft)\.?\s+.*$/i;
const ANNOTATION_TAIL = /^(feat|ft|prod|from|remaster|remastered)\b/i;
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const CENSOR_MARK = '*';
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

function removeAnnotationDashTail(value: string): string {
    const separatorIndex = value.indexOf(DASH_SEPARATOR);

    if (separatorIndex === -1) {
        return value;
    }

    if (!ANNOTATION_TAIL.test(value.slice(separatorIndex + 3).trim())) {
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
        result = removeAnnotationDashTail(result);
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

export function sourceTitleForms({
    name,
    version,
}: Pick<Track, 'name' | 'version'>): Set<string> {
    const variants = version
        ? [name, `${name}${DASH_SEPARATOR}${version}`, `${name} (${version})`]
        : [name];
    const forms = new Set<string>();

    for (const variant of variants) {
        const { full, stripped } = normalizeTitle(variant);
        forms.add(full);
        forms.add(stripped);
    }

    forms.delete('');

    return forms;
}

export function titleMatches(
    candidateName: string,
    forms: ReadonlySet<string>,
): boolean {
    const { full, stripped } = normalizeTitle(candidateName);

    return forms.has(full) || forms.has(stripped);
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

export function closestByDuration(
    candidates: SpotifyTrack[],
    sourceDurationMs: number | undefined,
    toleranceMs: number,
): SpotifyTrack | null {
    if (!candidates.length) {
        return null;
    }

    if (sourceDurationMs === undefined) {
        return candidates[0];
    }

    let best: SpotifyTrack | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        if (candidate.duration_ms === undefined) {
            continue;
        }

        const delta = Math.abs(candidate.duration_ms - sourceDurationMs);
        if (delta < bestDelta) {
            best = candidate;
            bestDelta = delta;
        }
    }

    if (!best) {
        return candidates[0];
    }

    if (bestDelta > toleranceMs) {
        return null;
    }

    return best;
}

export function censoredTitlePattern(title: string): RegExp | null {
    if (!title.includes(CENSOR_MARK)) {
        return null;
    }

    const pattern = [...title]
        .map((character) =>
            character === CENSOR_MARK
                ? '.'
                : character.replace(REGEXP_SPECIALS, '\\$&'),
        )
        .join('');

    return new RegExp(`^${pattern}$`, 'iu');
}

export function isPrefixMatch(left: string, right: string): boolean {
    const a = normalizeTitle(left).full;
    const b = normalizeTitle(right).full;

    if (!a || !b) {
        return false;
    }

    return a.startsWith(b) || b.startsWith(a);
}
