import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { IConfig } from '../../config.js';
import { LastRun, PlaylistRunResult } from '../../entities.js';
import { ConfigService } from '../config.service.js';
import { LogService } from '../log.service.js';
import {
    Notifier,
    NoopNotifier,
    RelayFetch,
    RelayNotifier,
} from './notifier.js';

function playlist(overrides: Partial<PlaylistRunResult>): PlaylistRunResult {
    return {
        name: 'Playlist',
        status: 'ok',
        sourceTracks: 0,
        matched: 0,
        added: 0,
        notFound: 0,
        ...overrides,
    };
}

function lastRun(playlists: PlaylistRunResult[]): LastRun {
    return {
        startedAt: 1000,
        finishedAt: 6000,
        durationMs: 5000,
        status: 'ok',
        playlists,
    };
}

const notableRun = lastRun([
    playlist({ name: 'Chill Mix', status: 'ok', added: 2, notFound: 0 }),
]);

const silentRun = lastRun([
    playlist({ name: 'Steady', status: 'ok', added: 0, notFound: 4 }),
]);

function makeLog(): { logService: LogService; errors: string[] } {
    const errors: string[] = [];
    const logService = {
        error: (message: string | Error) => {
            errors.push(
                typeof message === 'string' ? message : message.message,
            );
        },
    } as unknown as LogService;

    return { logService, errors };
}

function makeConfig(): ConfigService<IConfig> {
    return new ConfigService<IConfig>({
        notify: { url: 'https://relay.test/send', secret: 's3cret' },
    } as IConfig);
}

function recordingFetch(response: Pick<Response, 'ok' | 'status'>): {
    fetchFn: RelayFetch;
    calls: { url: string; init?: RequestInit }[];
} {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn: RelayFetch = async (url, init) => {
        calls.push({ url, init });
        return response;
    };

    return { fetchFn, calls };
}

test('RelayNotifier posts the digest to the relay with the secret header', async () => {
    const { logService, errors } = makeLog();
    const { fetchFn, calls } = recordingFetch({ ok: true, status: 200 });

    await new RelayNotifier(logService, makeConfig(), fetchFn).notify(
        notableRun,
    );

    assert.equal(calls.length, 1);

    const { url, init } = calls[0];
    assert.equal(url, 'https://relay.test/send');
    assert.equal(init?.method, 'POST');

    const headers = init?.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['X-Secret'], 's3cret');

    const body = JSON.parse(init?.body as string);
    assert.equal(body.parse_mode, 'md');
    assert.equal(
        body.message,
        ['🎵 Playlist Sync', '---', '✅ Sync OK', '', '✅ Chill Mix: +2'].join(
            '\n',
        ),
    );

    assert.ok(init?.signal instanceof AbortSignal);
    assert.deepEqual(errors, []);
});

test('RelayNotifier sends nothing when the run summarizes to null', async () => {
    const { logService, errors } = makeLog();
    const { fetchFn, calls } = recordingFetch({ ok: true, status: 200 });

    await new RelayNotifier(logService, makeConfig(), fetchFn).notify(
        silentRun,
    );

    assert.equal(calls.length, 0);
    assert.deepEqual(errors, []);
});

test('RelayNotifier sends nothing for a null run', async () => {
    const { logService } = makeLog();
    const { fetchFn, calls } = recordingFetch({ ok: true, status: 200 });

    await new RelayNotifier(logService, makeConfig(), fetchFn).notify(null);

    assert.equal(calls.length, 0);
});

test('RelayNotifier logs an error and does not throw on a non-ok response', async () => {
    const { logService, errors } = makeLog();
    const { fetchFn } = recordingFetch({ ok: false, status: 500 });

    await new RelayNotifier(logService, makeConfig(), fetchFn).notify(
        notableRun,
    );

    assert.deepEqual(errors, ['notify failed: HTTP 500']);
});

test('RelayNotifier logs an error and does not throw when fetch rejects', async () => {
    const { logService, errors } = makeLog();
    const fetchFn: RelayFetch = async () => {
        throw new Error('network down');
    };

    await new RelayNotifier(logService, makeConfig(), fetchFn).notify(
        notableRun,
    );

    assert.deepEqual(errors, ['notify failed: network down']);
});

test('NoopNotifier resolves without sending anything', async () => {
    const notifier: Notifier = new NoopNotifier();
    const result = await notifier.notify(notableRun);

    assert.equal(result, undefined);
});
