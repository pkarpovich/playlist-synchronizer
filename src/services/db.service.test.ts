import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, TestContext } from 'node:test';

import { IConfig } from '../config.js';
import { ConfigService } from './config.service.js';
import { DbService, parseLegacyRefreshToken } from './db.service.js';
import { LogService } from './log.service.js';

const DbFile = 'sync.db';

interface LogEntry {
    level: string;
    message: string;
}

function makeLogStub(logs: LogEntry[]): LogService {
    const push = (level: string) => (message: string | Error) =>
        logs.push({ level, message: String(message) });

    return {
        createScope: () => ({}),
        info: push('info'),
        warn: push('warn'),
        success: push('success'),
        error: push('error'),
        await: push('await'),
    } as unknown as LogService;
}

function makeDbService(dbPath: string, logs: LogEntry[] = []): DbService {
    const configService = new ConfigService<IConfig>({ dbPath } as IConfig);

    return new DbService(configService, makeLogStub(logs));
}

function makeTempDir(t: TestContext): string {
    const dir = mkdtempSync(join(tmpdir(), 'playlist-synchronizer-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    return dir;
}

function listTables(dbFilePath: string): string[] {
    const db = new DatabaseSync(dbFilePath);
    const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
    db.close();

    return rows.map((row) => String(row.name));
}

test('creates the three tables on construction', (t) => {
    const dir = makeTempDir(t);
    makeDbService(dir);

    const tables = listTables(join(dir, DbFile));

    assert.ok(tables.includes('auth'));
    assert.ok(tables.includes('track_map'));
    assert.ok(tables.includes('playlist_state'));
});

function listColumns(dbFilePath: string, table: string): string[] {
    const db = new DatabaseSync(dbFilePath);
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    db.close();

    return rows.map((row) => String(row.name));
}

function seedDb(dbFilePath: string, sql: string): void {
    const db = new DatabaseSync(dbFilePath);
    db.exec(sql);
    db.close();
}

test('drops a playlist_state table that predates source scoping', (t) => {
    const dir = makeTempDir(t);
    const dbFilePath = join(dir, DbFile);
    seedDb(
        dbFilePath,
        `CREATE TABLE playlist_state (
            target_type TEXT,
            target_playlist_id TEXT,
            target_uri TEXT,
            source_type TEXT,
            source_id TEXT,
            added_at INTEGER,
            PRIMARY KEY (target_type, target_playlist_id, target_uri)
        );
        INSERT INTO playlist_state VALUES ('spotify', 'target-1', 'spotify:track:1', 'yandex', 'src-1', 1);`,
    );

    const dbService = makeDbService(dir);

    assert.ok(
        listColumns(dbFilePath, 'playlist_state').includes(
            'source_playlist_id',
        ),
    );
    assert.deepEqual(
        dbService.listPlaylistState({
            targetType: 'spotify',
            targetPlaylistId: 'target-1',
            sourcePlaylistId: 'source-1',
        }),
        [],
    );
});

test('keeps a playlist_state table that already carries the source scope', (t) => {
    const dir = makeTempDir(t);
    const dbFilePath = join(dir, DbFile);
    seedDb(
        dbFilePath,
        `CREATE TABLE playlist_state (
            target_type TEXT,
            target_playlist_id TEXT,
            source_playlist_id TEXT,
            target_uri TEXT,
            source_type TEXT,
            source_id TEXT,
            added_at INTEGER,
            PRIMARY KEY (target_type, target_playlist_id, source_playlist_id, target_uri)
        );
        INSERT INTO playlist_state VALUES ('spotify', 'target-1', 'source-1', 'spotify:track:1', 'yandex', 'src-1', 1);`,
    );

    const dbService = makeDbService(dir);

    assert.deepEqual(
        dbService.listPlaylistState({
            targetType: 'spotify',
            targetPlaylistId: 'target-1',
            sourcePlaylistId: 'source-1',
        }),
        [
            {
                targetUri: 'spotify:track:1',
                sourceType: 'yandex',
                sourceId: 'src-1',
                addedAt: 1,
            },
        ],
    );
});

test('reading an unknown auth service returns null', () => {
    const dbService = makeDbService(':memory:');

    assert.equal(dbService.getAuth('spotify'), null);
});

test('auth values round-trip through the database', () => {
    const dbService = makeDbService(':memory:');

    dbService.setRefreshToken('spotify', 'refresh-1');
    dbService.setRevokedAt('spotify', 1700000000000);
    dbService.setPendingState('spotify', 'state-1');

    assert.deepEqual(dbService.getAuth('spotify'), {
        service: 'spotify',
        refreshToken: 'refresh-1',
        revokedAt: 1700000000000,
        pendingState: 'state-1',
    });

    dbService.setRefreshToken('spotify', '');
    dbService.setRevokedAt('spotify', null);
    dbService.setPendingState('spotify', null);

    assert.deepEqual(dbService.getAuth('spotify'), {
        service: 'spotify',
        refreshToken: '',
        revokedAt: null,
        pendingState: null,
    });
});

test('writing a single auth column creates a row with defaults', () => {
    const dbService = makeDbService(':memory:');

    dbService.setPendingState('spotify', 'state-1');

    assert.deepEqual(dbService.getAuth('spotify'), {
        service: 'spotify',
        refreshToken: '',
        revokedAt: null,
        pendingState: 'state-1',
    });
});

test('migration imports the legacy refresh token and leaves db.json in place', (t) => {
    const dir = makeTempDir(t);
    const legacyFile = join(dir, 'db.json');
    writeFileSync(legacyFile, JSON.stringify({ refreshToken: 'legacy-1' }));

    const logs: LogEntry[] = [];
    const dbService = makeDbService(dir, logs);

    assert.equal(dbService.getAuth('spotify')?.refreshToken, 'legacy-1');
    assert.ok(existsSync(legacyFile));
    assert.equal(logs.filter(({ level }) => level === 'info').length, 1);
});

test('migration is a no-op on the second call', (t) => {
    const dir = makeTempDir(t);
    writeFileSync(
        join(dir, 'db.json'),
        JSON.stringify({ refreshToken: 'legacy-1' }),
    );

    const dbService = makeDbService(dir);
    dbService.setRefreshToken('spotify', 'rotated-1');

    dbService.migrateLegacyAuth();

    assert.equal(dbService.getAuth('spotify')?.refreshToken, 'rotated-1');
});

test('migration ignores a malformed db.json', (t) => {
    const dir = makeTempDir(t);
    writeFileSync(join(dir, 'db.json'), '{ not json');

    const dbService = makeDbService(dir);

    assert.equal(dbService.getAuth('spotify'), null);
});

test('migration ignores a db.json without a refresh token', (t) => {
    const dir = makeTempDir(t);
    writeFileSync(join(dir, 'db.json'), JSON.stringify({ refreshToken: '' }));

    const dbService = makeDbService(dir);

    assert.equal(dbService.getAuth('spotify'), null);
});

test('migration ignores an absent db.json', () => {
    const dbService = makeDbService(':memory:');

    assert.equal(dbService.getAuth('spotify'), null);
});

test('playlist state rows round-trip per playlist', () => {
    const dbService = makeDbService(':memory:');
    const key = {
        targetType: 'spotify',
        targetPlaylistId: 'sp-1',
        sourcePlaylistId: 'src-1',
    };

    dbService.addPlaylistState(
        key,
        {
            targetUri: 'spotify:track:1',
            sourceType: 'yandexMusic',
            sourceId: 'y-1',
        },
        1000,
    );
    dbService.addPlaylistState(
        {
            targetType: 'spotify',
            targetPlaylistId: 'sp-2',
            sourcePlaylistId: 'src-1',
        },
        {
            targetUri: 'spotify:track:2',
            sourceType: 'yandexMusic',
            sourceId: 'y-2',
        },
        2000,
    );

    assert.deepEqual(dbService.listPlaylistState(key), [
        {
            targetUri: 'spotify:track:1',
            sourceType: 'yandexMusic',
            sourceId: 'y-1',
            addedAt: 1000,
        },
    ]);
});

test('an unknown playlist has no state rows', () => {
    const dbService = makeDbService(':memory:');

    assert.deepEqual(
        dbService.listPlaylistState({
            targetType: 'spotify',
            targetPlaylistId: 'unknown',
            sourcePlaylistId: 'src-1',
        }),
        [],
    );
});

test('rows of another source playlist stay invisible to this one', () => {
    const dbService = makeDbService(':memory:');
    const fromA = {
        targetType: 'spotify',
        targetPlaylistId: 'sp-1',
        sourcePlaylistId: 'src-a',
    };
    const fromB = { ...fromA, sourcePlaylistId: 'src-b' };

    dbService.addPlaylistState(
        fromA,
        {
            targetUri: 'spotify:track:1',
            sourceType: 'yandexMusic',
            sourceId: 'y-a',
        },
        1000,
    );
    dbService.addPlaylistState(
        fromB,
        {
            targetUri: 'spotify:track:2',
            sourceType: 'yandexMusic',
            sourceId: 'y-b',
        },
        2000,
    );

    assert.deepEqual(
        dbService.listPlaylistState(fromA).map(({ sourceId }) => sourceId),
        ['y-a'],
    );
    assert.deepEqual(
        dbService.listPlaylistState(fromB).map(({ sourceId }) => sourceId),
        ['y-b'],
    );

    dbService.deletePlaylistState(fromA, ['spotify:track:1']);

    assert.equal(dbService.listPlaylistState(fromA).length, 0);
    assert.equal(dbService.listPlaylistState(fromB).length, 1);
});

test('URIs of other source playlists are listed for the same target', () => {
    const dbService = makeDbService(':memory:');
    const fromA = {
        targetType: 'spotify',
        targetPlaylistId: 'sp-1',
        sourcePlaylistId: 'src-a',
    };
    const fromB = { ...fromA, sourcePlaylistId: 'src-b' };
    const otherTarget = { ...fromB, targetPlaylistId: 'sp-2' };
    const entry = { sourceType: 'yandexMusic', sourceId: 'y-1' };

    dbService.addPlaylistState(
        fromA,
        { ...entry, targetUri: 'spotify:track:shared' },
        1000,
    );
    dbService.addPlaylistState(
        fromB,
        { ...entry, targetUri: 'spotify:track:shared' },
        2000,
    );
    dbService.addPlaylistState(
        fromB,
        { ...entry, targetUri: 'spotify:track:b-only' },
        2000,
    );
    dbService.addPlaylistState(
        otherTarget,
        { ...entry, targetUri: 'spotify:track:elsewhere' },
        3000,
    );

    assert.deepEqual(dbService.listOtherSourceUris(fromA).sort(), [
        'spotify:track:b-only',
        'spotify:track:shared',
    ]);
    assert.deepEqual(dbService.listOtherSourceUris(fromB), [
        'spotify:track:shared',
    ]);
});

test('adding the same URI twice keeps one row with the latest source', () => {
    const dbService = makeDbService(':memory:');
    const key = {
        targetType: 'spotify',
        targetPlaylistId: 'sp-1',
        sourcePlaylistId: 'src-1',
    };

    dbService.addPlaylistState(
        key,
        {
            targetUri: 'spotify:track:1',
            sourceType: 'yandexMusic',
            sourceId: 'y-1',
        },
        1000,
    );
    dbService.addPlaylistState(
        key,
        {
            targetUri: 'spotify:track:1',
            sourceType: 'yandexMusic',
            sourceId: 'y-2',
        },
        3000,
    );

    assert.deepEqual(dbService.listPlaylistState(key), [
        {
            targetUri: 'spotify:track:1',
            sourceType: 'yandexMusic',
            sourceId: 'y-2',
            addedAt: 3000,
        },
    ]);
});

test('deleting by URI removes only the listed rows of that playlist', () => {
    const dbService = makeDbService(':memory:');
    const key = {
        targetType: 'spotify',
        targetPlaylistId: 'sp-1',
        sourcePlaylistId: 'src-1',
    };
    const otherKey = { ...key, targetPlaylistId: 'sp-2' };

    for (const targetUri of ['spotify:track:1', 'spotify:track:2']) {
        dbService.addPlaylistState(
            key,
            { targetUri, sourceType: 'yandexMusic', sourceId: 'y-1' },
            1000,
        );
        dbService.addPlaylistState(
            otherKey,
            { targetUri, sourceType: 'yandexMusic', sourceId: 'y-1' },
            1000,
        );
    }

    dbService.deletePlaylistState(key, ['spotify:track:1', 'spotify:track:3']);

    assert.deepEqual(
        dbService.listPlaylistState(key).map(({ targetUri }) => targetUri),
        ['spotify:track:2'],
    );
    assert.equal(dbService.listPlaylistState(otherKey).length, 2);
});

test('parseLegacyRefreshToken rejects everything but a non-empty token', () => {
    assert.equal(
        parseLegacyRefreshToken(JSON.stringify({ refreshToken: 'token-1' })),
        'token-1',
    );
    assert.equal(parseLegacyRefreshToken('{ not json'), null);
    assert.equal(parseLegacyRefreshToken('null'), null);
    assert.equal(parseLegacyRefreshToken('"token-1"'), null);
    assert.equal(parseLegacyRefreshToken(JSON.stringify({})), null);
    assert.equal(
        parseLegacyRefreshToken(JSON.stringify({ refreshToken: 42 })),
        null,
    );
});
