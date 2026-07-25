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
        target_uri TEXT,
        source_type TEXT,
        source_id TEXT,
        added_at INTEGER,
        PRIMARY KEY (target_type, target_playlist_id, target_uri)
    );
`;

type AuthColumn = 'refresh_token' | 'revoked_at' | 'pending_state';

export type AuthRecord = {
    service: string;
    refreshToken: string;
    revokedAt: number | null;
    pendingState: string | null;
};

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
        this.db.exec(Schema);
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
