import { DbService, TrackMapEntry, TrackMapKey } from '../services.js';
import { MusicServiceTypes } from '../entities.js';

const SourceType = MusicServiceTypes.YANDEX_MUSIC;
const TargetType = MusicServiceTypes.SPOTIFY;
const SpotifyTrackUri = /^spotify:track:[A-Za-z0-9]+$/;
const UnresolvedFlag = '--unresolved';
const NameColumnWidth = 40;

export type CommandResult = {
    output: string[];
    exitCode: number;
};

export const Usage = [
    'Usage:',
    '  cli.js list [--unresolved]        show every stored mapping',
    '  cli.js map <sourceId> <uri>       pin a Yandex track to a Spotify track URI',
    '  cli.js unmap <sourceId>           drop a mapping so the next run resolves it again',
    '  cli.js skip <sourceId>            confirm the track is absent from Spotify and stop searching',
    '  cli.js unskip <sourceId>          resume searching for a skipped track',
];

function keyFor(sourceId: string): TrackMapKey {
    return { sourceType: SourceType, sourceId, targetType: TargetType };
}

function pad(value: string, width: number): string {
    if (value.length >= width) {
        return value.slice(0, width - 1) + '…';
    }

    return value.padEnd(width);
}

function describe(entry: TrackMapEntry): string {
    const name = pad(entry.sourceName ?? '(unknown title)', NameColumnWidth);
    const id = entry.sourceId.padEnd(12);

    if (entry.skippedAt) {
        return `${id} ${name} skipped, absent from Spotify`;
    }

    if (!entry.targetUri) {
        return `${id} ${name} unresolved after ${entry.attempts} attempt(s)`;
    }

    const duration =
        entry.durationMs === null ? '' : ` (${entry.durationMs} ms)`;

    return `${id} ${name} ${entry.targetUri}${duration}`;
}

function list(dbService: DbService, unresolvedOnly: boolean): CommandResult {
    const entries = dbService
        .listTrackMap()
        .filter(
            (entry) =>
                !unresolvedOnly || (!entry.targetUri && !entry.skippedAt),
        );

    if (!entries.length) {
        return { output: ['no mappings stored'], exitCode: 0 };
    }

    const resolved = entries.filter((entry) => entry.targetUri).length;
    const skipped = entries.filter((entry) => entry.skippedAt).length;

    return {
        output: [
            ...entries.map(describe),
            '',
            `${entries.length} mapping(s), ${resolved} resolved, ${entries.length - resolved - skipped} unresolved, ${skipped} skipped`,
        ],
        exitCode: 0,
    };
}

function map(
    dbService: DbService,
    [sourceId, targetUri]: string[],
    now: () => number,
): CommandResult {
    if (!sourceId || !targetUri) {
        return {
            output: ['map needs a source id and a Spotify track URI', ...Usage],
            exitCode: 1,
        };
    }

    if (!SpotifyTrackUri.test(targetUri)) {
        return {
            output: [`not a Spotify track URI: ${targetUri}`],
            exitCode: 1,
        };
    }

    const key = keyFor(sourceId);
    const existing = dbService.getTrackMap(key);

    dbService.setTrackResolution(
        key,
        {
            sourceName: existing?.sourceName ?? null,
            targetUri,
            isrc: null,
            durationMs: null,
        },
        now(),
    );

    const previous = existing?.targetUri
        ? ` (was ${existing.targetUri})`
        : ' (was unresolved)';

    return {
        output: [`mapped ${sourceId} to ${targetUri}${previous}`],
        exitCode: 0,
    };
}

function unmap(dbService: DbService, [sourceId]: string[]): CommandResult {
    if (!sourceId) {
        return {
            output: ['unmap needs a source id', ...Usage],
            exitCode: 1,
        };
    }

    if (!dbService.deleteTrackMap(keyFor(sourceId))) {
        return { output: [`no mapping stored for ${sourceId}`], exitCode: 1 };
    }

    return {
        output: [`dropped the mapping for ${sourceId}`],
        exitCode: 0,
    };
}

function skip(
    dbService: DbService,
    [sourceId]: string[],
    now: () => number,
): CommandResult {
    if (!sourceId) {
        return { output: ['skip needs a source id', ...Usage], exitCode: 1 };
    }

    const key = keyFor(sourceId);
    const existing = dbService.getTrackMap(key);

    if (existing?.skippedAt) {
        return { output: [`${sourceId} is already skipped`], exitCode: 0 };
    }

    dbService.setTrackSkipped(key, existing?.sourceName ?? null, now());

    const previous = existing?.targetUri
        ? ` (dropped ${existing.targetUri})`
        : '';

    return {
        output: [
            `skipping ${sourceId}: confirmed absent from Spotify, it will not be searched again${previous}`,
        ],
        exitCode: 0,
    };
}

function unskip(dbService: DbService, [sourceId]: string[]): CommandResult {
    if (!sourceId) {
        return { output: ['unskip needs a source id', ...Usage], exitCode: 1 };
    }

    if (!dbService.clearTrackSkipped(keyFor(sourceId))) {
        return { output: [`${sourceId} is not skipped`], exitCode: 1 };
    }

    return {
        output: [`${sourceId} will be searched again on the next run`],
        exitCode: 0,
    };
}

export function runMappingCommand(
    argv: string[],
    dbService: DbService,
    now: () => number,
): CommandResult {
    const [command, ...args] = argv;

    if (command === 'list') {
        return list(dbService, args.includes(UnresolvedFlag));
    }

    if (command === 'map') {
        return map(dbService, args, now);
    }

    if (command === 'unmap') {
        return unmap(dbService, args);
    }

    if (command === 'skip') {
        return skip(dbService, args, now);
    }

    if (command === 'unskip') {
        return unskip(dbService, args);
    }

    return {
        output: command ? [`unknown command: ${command}`, ...Usage] : Usage,
        exitCode: 1,
    };
}
