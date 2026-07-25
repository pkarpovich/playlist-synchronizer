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
        .filter((entry) => !unresolvedOnly || !entry.targetUri);

    if (!entries.length) {
        return { output: ['no mappings stored'], exitCode: 0 };
    }

    const resolved = entries.filter((entry) => entry.targetUri).length;

    return {
        output: [
            ...entries.map(describe),
            '',
            `${entries.length} mapping(s), ${resolved} resolved, ${entries.length - resolved} unresolved`,
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

    return {
        output: command ? [`unknown command: ${command}`, ...Usage] : Usage,
        exitCode: 1,
    };
}
