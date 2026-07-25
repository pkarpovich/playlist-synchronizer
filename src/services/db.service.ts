import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ConfigService } from './config.service.js';
import { LogService } from './log.service.js';
import { IConfig } from '../config.js';

const MemoryLocation = ':memory:';
const DbFileName = 'sync.db';
const LegacyDbFileName = 'db.json';
const LegacyAuthService = 'spotify';

const Schema = `
    CREATE TABLE IF NOT EXISTS auth (
        service TEXT PRIMARY KEY,
        refresh_token TEXT NOT NULL DEFAULT '',
        revoked_at INTEGER,
        pending_state TEXT
    );

    CREATE TABLE IF NOT EXISTS track_map (
        source_type TEXT,
        source_id TEXT,
        source_name TEXT,
        target_type TEXT,
        target_uri TEXT,
        isrc TEXT,
        duration_ms INTEGER,
        resolved_at INTEGER,
        last_tried_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (source_type, source_id, target_type)
    );

    CREATE TABLE IF NOT EXISTS playlist_state (
        target_type TEXT,
        target_playlist_id TEXT,
        source_playlist_id TEXT,
        target_uri TEXT,
        source_type TEXT,
        source_id TEXT,
        added_at INTEGER,
        PRIMARY KEY (target_type, target_playlist_id, source_playlist_id, target_uri)
    );
`;

const PlaylistStateSourceColumn = 'source_playlist_id';
const TrackMapNameColumn = 'source_name';

type AuthColumn = 'refresh_token' | 'revoked_at' | 'pending_state';

export type AuthRecord = {
    service: string;
    refreshToken: string;
    revokedAt: number | null;
    pendingState: string | null;
};

export type TrackMapKey = {
    sourceType: string;
    sourceId: string;
    targetType: string;
};

export type TrackMapRecord = {
    sourceName: string | null;
    targetUri: string | null;
    isrc: string | null;
    durationMs: number | null;
    resolvedAt: number | null;
    lastTriedAt: number | null;
    attempts: number;
};

export type TrackMapResolution = {
    sourceName: string | null;
    targetUri: string;
    isrc: string | null;
    durationMs: number | null;
};

export type TrackMapEntry = TrackMapKey & TrackMapRecord;

export type TrackMapCounts = {
    resolved: number;
    unresolved: number;
};

export type PlaylistStateKey = {
    targetType: string;
    targetPlaylistId: string;
    sourcePlaylistId: string;
};

export type PlaylistStateEntry = {
    targetUri: string;
    sourceType: string;
    sourceId: string;
};

export type PlaylistStateRecord = PlaylistStateEntry & {
    addedAt: number | null;
};

function toNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
}

function toStringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

export function parseLegacyRefreshToken(content: string): string | null {
    try {
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }

        const { refreshToken } = parsed as { refreshToken?: unknown };
        if (typeof refreshToken !== 'string' || !refreshToken) {
            return null;
        }

        return refreshToken;
    } catch {
        return null;
    }
}

function resolveDbLocation(dbPath: string): string {
    if (dbPath === MemoryLocation) {
        return MemoryLocation;
    }

    mkdirSync(dbPath, { recursive: true });
    return join(dbPath, DbFileName);
}

function dropUnscopedPlaylistState(db: DatabaseSync): void {
    const columns = db.prepare('PRAGMA table_info(playlist_state)').all();

    if (
        !columns.length ||
        columns.some(({ name }) => name === PlaylistStateSourceColumn)
    ) {
        return;
    }

    db.exec('DROP TABLE playlist_state');
}

function addTrackMapSourceName(db: DatabaseSync): void {
    const columns = db.prepare('PRAGMA table_info(track_map)').all();

    if (columns.some(({ name }) => name === TrackMapNameColumn)) {
        return;
    }

    db.exec(`ALTER TABLE track_map ADD COLUMN ${TrackMapNameColumn} TEXT`);
}

function readLegacyFile(filePath: string): string | null {
    try {
        return readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

export class DbService {
    private readonly db: DatabaseSync;

    private readonly legacyFilePath: string;

    constructor(
        configService: ConfigService<IConfig>,
        private readonly logService: LogService,
    ) {
        const dbPath: string = configService.get('dbPath');

        this.legacyFilePath = join(dbPath, LegacyDbFileName);
        this.db = new DatabaseSync(resolveDbLocation(dbPath));
        dropUnscopedPlaylistState(this.db);
        this.db.exec(Schema);
        addTrackMapSourceName(this.db);
        this.migrateLegacyAuth();
    }

    getAuth(service: string): AuthRecord | null {
        const row = this.db
            .prepare(
                'SELECT service, refresh_token, revoked_at, pending_state FROM auth WHERE service = ?',
            )
            .get(service);

        if (!row) {
            return null;
        }

        return {
            service: String(row.service),
            refreshToken:
                typeof row.refresh_token === 'string' ? row.refresh_token : '',
            revokedAt:
                typeof row.revoked_at === 'number' ? row.revoked_at : null,
            pendingState:
                typeof row.pending_state === 'string'
                    ? row.pending_state
                    : null,
        };
    }

    setRefreshToken(service: string, refreshToken: string): void {
        this.writeAuthColumn(service, 'refresh_token', refreshToken);
    }

    setRevokedAt(service: string, revokedAt: number | null): void {
        this.writeAuthColumn(service, 'revoked_at', revokedAt);
    }

    setPendingState(service: string, pendingState: string | null): void {
        this.writeAuthColumn(service, 'pending_state', pendingState);
    }

    getTrackMap({
        sourceType,
        sourceId,
        targetType,
    }: TrackMapKey): TrackMapRecord | null {
        const row = this.db
            .prepare(
                'SELECT source_name, target_uri, isrc, duration_ms, resolved_at, last_tried_at, attempts FROM track_map WHERE source_type = ? AND source_id = ? AND target_type = ?',
            )
            .get(sourceType, sourceId, targetType);

        if (!row) {
            return null;
        }

        return {
            sourceName: toStringOrNull(row.source_name),
            targetUri: toStringOrNull(row.target_uri),
            isrc: toStringOrNull(row.isrc),
            durationMs: toNumberOrNull(row.duration_ms),
            resolvedAt: toNumberOrNull(row.resolved_at),
            lastTriedAt: toNumberOrNull(row.last_tried_at),
            attempts: Number(row.attempts ?? 0),
        };
    }

    setTrackResolution(
        { sourceType, sourceId, targetType }: TrackMapKey,
        { sourceName, targetUri, isrc, durationMs }: TrackMapResolution,
        triedAt: number,
    ): void {
        this.db
            .prepare(
                `INSERT INTO track_map (source_type, source_id, source_name, target_type, target_uri, isrc, duration_ms, resolved_at, last_tried_at, attempts)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                 ON CONFLICT(source_type, source_id, target_type) DO UPDATE SET
                     source_name = excluded.source_name,
                     target_uri = excluded.target_uri,
                     isrc = excluded.isrc,
                     duration_ms = excluded.duration_ms,
                     resolved_at = excluded.resolved_at,
                     last_tried_at = excluded.last_tried_at,
                     attempts = track_map.attempts + 1`,
            )
            .run(
                sourceType,
                sourceId,
                sourceName,
                targetType,
                targetUri,
                isrc,
                durationMs,
                triedAt,
                triedAt,
            );
    }

    setTrackMiss(
        { sourceType, sourceId, targetType }: TrackMapKey,
        sourceName: string | null,
        triedAt: number,
    ): void {
        this.db
            .prepare(
                `INSERT INTO track_map (source_type, source_id, source_name, target_type, target_uri, isrc, duration_ms, resolved_at, last_tried_at, attempts)
                 VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 1)
                 ON CONFLICT(source_type, source_id, target_type) DO UPDATE SET
                     source_name = excluded.source_name,
                     target_uri = NULL,
                     isrc = NULL,
                     duration_ms = NULL,
                     resolved_at = NULL,
                     last_tried_at = excluded.last_tried_at,
                     attempts = track_map.attempts + 1`,
            )
            .run(sourceType, sourceId, sourceName, targetType, triedAt);
    }

    listTrackMap(): TrackMapEntry[] {
        const rows = this.db
            .prepare(
                'SELECT source_type, source_id, source_name, target_type, target_uri, isrc, duration_ms, resolved_at, last_tried_at, attempts FROM track_map ORDER BY source_name, source_id',
            )
            .all();

        return rows.map((row) => ({
            sourceType: String(row.source_type),
            sourceId: String(row.source_id),
            sourceName: toStringOrNull(row.source_name),
            targetType: String(row.target_type),
            targetUri: toStringOrNull(row.target_uri),
            isrc: toStringOrNull(row.isrc),
            durationMs: toNumberOrNull(row.duration_ms),
            resolvedAt: toNumberOrNull(row.resolved_at),
            lastTriedAt: toNumberOrNull(row.last_tried_at),
            attempts: Number(row.attempts ?? 0),
        }));
    }

    deleteTrackMap({ sourceType, sourceId, targetType }: TrackMapKey): boolean {
        const { changes } = this.db
            .prepare(
                'DELETE FROM track_map WHERE source_type = ? AND source_id = ? AND target_type = ?',
            )
            .run(sourceType, sourceId, targetType);

        return Number(changes) > 0;
    }

    countTrackMap(): TrackMapCounts {
        const row = this.db
            .prepare(
                'SELECT COUNT(*) AS total, COUNT(target_uri) AS resolved FROM track_map',
            )
            .get();

        const total = Number(row?.total ?? 0);
        const resolved = Number(row?.resolved ?? 0);

        return { resolved, unresolved: total - resolved };
    }

    listPlaylistState({
        targetType,
        targetPlaylistId,
        sourcePlaylistId,
    }: PlaylistStateKey): PlaylistStateRecord[] {
        const rows = this.db
            .prepare(
                'SELECT target_uri, source_type, source_id, added_at FROM playlist_state WHERE target_type = ? AND target_playlist_id = ? AND source_playlist_id = ?',
            )
            .all(targetType, targetPlaylistId, sourcePlaylistId);

        return rows.map((row) => ({
            targetUri: String(row.target_uri),
            sourceType: String(row.source_type),
            sourceId: String(row.source_id),
            addedAt: toNumberOrNull(row.added_at),
        }));
    }

    listOtherSourceUris({
        targetType,
        targetPlaylistId,
        sourcePlaylistId,
    }: PlaylistStateKey): string[] {
        const rows = this.db
            .prepare(
                'SELECT DISTINCT target_uri FROM playlist_state WHERE target_type = ? AND target_playlist_id = ? AND source_playlist_id <> ?',
            )
            .all(targetType, targetPlaylistId, sourcePlaylistId);

        return rows.map((row) => String(row.target_uri));
    }

    addPlaylistState(
        { targetType, targetPlaylistId, sourcePlaylistId }: PlaylistStateKey,
        { targetUri, sourceType, sourceId }: PlaylistStateEntry,
        addedAt: number,
    ): void {
        this.db
            .prepare(
                `INSERT INTO playlist_state (target_type, target_playlist_id, source_playlist_id, target_uri, source_type, source_id, added_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(target_type, target_playlist_id, source_playlist_id, target_uri) DO UPDATE SET
                     source_type = excluded.source_type,
                     source_id = excluded.source_id,
                     added_at = excluded.added_at`,
            )
            .run(
                targetType,
                targetPlaylistId,
                sourcePlaylistId,
                targetUri,
                sourceType,
                sourceId,
                addedAt,
            );
    }

    deletePlaylistState(
        { targetType, targetPlaylistId, sourcePlaylistId }: PlaylistStateKey,
        targetUris: string[],
    ): void {
        const statement = this.db.prepare(
            'DELETE FROM playlist_state WHERE target_type = ? AND target_playlist_id = ? AND source_playlist_id = ? AND target_uri = ?',
        );

        for (const targetUri of targetUris) {
            statement.run(
                targetType,
                targetPlaylistId,
                sourcePlaylistId,
                targetUri,
            );
        }
    }

    migrateLegacyAuth(): void {
        if (this.getAuth(LegacyAuthService)) {
            return;
        }

        const content = readLegacyFile(this.legacyFilePath);
        if (!content) {
            return;
        }

        const refreshToken = parseLegacyRefreshToken(content);
        if (!refreshToken) {
            return;
        }

        this.setRefreshToken(LegacyAuthService, refreshToken);
        this.logService.info(
            `Imported Spotify refresh token from ${this.legacyFilePath}`,
        );
    }

    private writeAuthColumn(
        service: string,
        column: AuthColumn,
        value: string | number | null,
    ): void {
        this.db
            .prepare(
                `INSERT INTO auth (service, ${column}) VALUES (?, ?) ON CONFLICT(service) DO UPDATE SET ${column} = excluded.${column}`,
            )
            .run(service, value);
    }
}
