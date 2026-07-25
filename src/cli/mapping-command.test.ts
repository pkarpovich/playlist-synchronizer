import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { IConfig } from '../config.js';
import { ConfigService } from '../services/config.service.js';
import { DbService } from '../services/db.service.js';
import { LogService } from '../services/log.service.js';
import { runMappingCommand } from './mapping-command.js';

const Now = 1_750_000_000_000;
const key = {
    sourceType: 'yandex',
    sourceId: '145513389',
    targetType: 'spotify',
};

function makeDbService(): DbService {
    const logService = {
        createScope: () => ({}),
        info: () => undefined,
        warn: () => undefined,
        success: () => undefined,
        error: () => undefined,
        await: () => undefined,
    } as unknown as LogService;

    return new DbService(
        new ConfigService<IConfig>({ dbPath: ':memory:' } as IConfig),
        logService,
    );
}

function run(dbService: DbService, ...argv: string[]) {
    return runMappingCommand(argv, dbService, () => Now);
}

function seedResolved(dbService: DbService): void {
    dbService.setTrackResolution(
        key,
        {
            sourceName: 'Быть богатым',
            targetUri: 'spotify:track:oldoldoldoldoldoldoldo',
            isrc: 'RUAGW2511068',
            durationMs: 176862,
        },
        Now,
    );
}

test('an unknown command prints the usage and fails', () => {
    const result = run(makeDbService(), 'wat');

    assert.equal(result.exitCode, 1);
    assert.ok(result.output[0].includes('unknown command: wat'));
    assert.ok(result.output.some((line) => line.startsWith('Usage:')));
});

test('no command at all prints the usage and fails', () => {
    const result = run(makeDbService());

    assert.equal(result.exitCode, 1);
    assert.ok(result.output[0].startsWith('Usage:'));
});

test('list reports an empty store', () => {
    const result = run(makeDbService(), 'list');

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.output, ['no mappings stored']);
});

test('list shows the title, the source id and the target uri', () => {
    const dbService = makeDbService();
    seedResolved(dbService);

    const result = run(dbService, 'list');

    assert.equal(result.exitCode, 0);
    assert.ok(result.output[0].includes('145513389'));
    assert.ok(result.output[0].includes('Быть богатым'));
    assert.ok(
        result.output[0].includes('spotify:track:oldoldoldoldoldoldoldo'),
    );
    assert.ok(result.output.at(-1)?.includes('1 mapping(s), 1 resolved'));
});

test('list marks an unresolved row with its attempt count', () => {
    const dbService = makeDbService();
    dbService.setTrackMiss(key, 'ЭКСПОЗИЦИЯ', Now);

    const result = run(dbService, 'list');

    assert.ok(result.output[0].includes('unresolved after 1 attempt(s)'));
    assert.ok(result.output.at(-1)?.includes('0 resolved, 1 unresolved'));
});

test('list --unresolved hides the resolved rows', () => {
    const dbService = makeDbService();
    seedResolved(dbService);
    dbService.setTrackMiss({ ...key, sourceId: 'missing-1' }, 'Missing', Now);

    const result = run(dbService, 'list', '--unresolved');

    assert.equal(result.output.length, 3);
    assert.ok(result.output[0].includes('missing-1'));
    assert.ok(!result.output[0].includes('145513389'));
});

test('map pins a track and reports what it replaced', () => {
    const dbService = makeDbService();
    seedResolved(dbService);

    const result = run(
        dbService,
        'map',
        '145513389',
        'spotify:track:3fvTuOnHeSB2OGXNqsmVnd',
    );

    assert.equal(result.exitCode, 0);
    assert.ok(
        result.output[0].includes('spotify:track:3fvTuOnHeSB2OGXNqsmVnd'),
    );
    assert.ok(
        result.output[0].includes('was spotify:track:oldoldoldoldoldoldoldo'),
    );
    assert.equal(
        dbService.getTrackMap(key)?.targetUri,
        'spotify:track:3fvTuOnHeSB2OGXNqsmVnd',
    );
});

test('map keeps the stored title and clears the stale isrc and duration', () => {
    const dbService = makeDbService();
    seedResolved(dbService);

    run(dbService, 'map', '145513389', 'spotify:track:3fvTuOnHeSB2OGXNqsmVnd');
    const record = dbService.getTrackMap(key);

    assert.equal(record?.sourceName, 'Быть богатым');
    assert.equal(record?.isrc, null);
    assert.equal(record?.durationMs, null);
});

test('map works on a source id that was never resolved', () => {
    const dbService = makeDbService();

    const result = run(
        dbService,
        'map',
        '999',
        'spotify:track:3fvTuOnHeSB2OGXNqsmVnd',
    );

    assert.equal(result.exitCode, 0);
    assert.ok(result.output[0].includes('was unresolved'));
});

test('map rejects anything that is not a Spotify track URI', () => {
    const dbService = makeDbService();

    for (const uri of [
        'spotify:album:3fvTuOnHeSB2OGXNqsmVnd',
        'https://open.spotify.com/track/3fvTuOnHeSB2OGXNqsmVnd',
        '3fvTuOnHeSB2OGXNqsmVnd',
        'spotify:track:',
    ]) {
        const result = run(dbService, 'map', '145513389', uri);

        assert.equal(result.exitCode, 1);
        assert.ok(result.output[0].includes('not a Spotify track URI'));
    }

    assert.equal(dbService.getTrackMap(key), null);
});

test('map without both arguments fails with the usage', () => {
    const dbService = makeDbService();

    assert.equal(run(dbService, 'map').exitCode, 1);
    assert.equal(run(dbService, 'map', '145513389').exitCode, 1);
    assert.ok(
        run(dbService, 'map').output.some((line) => line.startsWith('Usage:')),
    );
});

test('unmap drops the row so the next run resolves it again', () => {
    const dbService = makeDbService();
    seedResolved(dbService);

    const result = run(dbService, 'unmap', '145513389');

    assert.equal(result.exitCode, 0);
    assert.ok(result.output[0].includes('dropped the mapping for 145513389'));
    assert.equal(dbService.getTrackMap(key), null);
});

test('unmap reports a missing row instead of pretending it worked', () => {
    const result = run(makeDbService(), 'unmap', '145513389');

    assert.equal(result.exitCode, 1);
    assert.ok(result.output[0].includes('no mapping stored for 145513389'));
});

test('unmap without a source id fails with the usage', () => {
    const result = run(makeDbService(), 'unmap');

    assert.equal(result.exitCode, 1);
    assert.ok(result.output.some((line) => line.startsWith('Usage:')));
});
