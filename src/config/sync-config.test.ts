import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getSyncConfig } from './sync-config.js';

async function withConfigFile(
    contents: unknown,
    fn: (path: string) => Promise<void>,
): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'sync-config-'));
    const path = join(dir, 'sync.config.json');
    await writeFile(path, JSON.stringify(contents));

    try {
        await fn(path);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

const validPlaylist = {
    type: 'yandex',
    metadata: { id: '1', userName: 'u' },
    excludedTrackIds: [],
    targetPlaylists: [{ type: 'spotify', metadata: { id: '2' } }],
};

test('getSyncConfig rejects a config with no playlists', async () => {
    await withConfigFile({ playlists: [] }, async (path) => {
        await assert.rejects(() => getSyncConfig(path));
    });
});

test('getSyncConfig accepts a config with at least one playlist', async () => {
    await withConfigFile({ playlists: [validPlaylist] }, async (path) => {
        const config = await getSyncConfig(path);
        assert.equal(config.playlists.length, 1);
    });
});

test('getSyncConfig rejects a playlist with no target playlists', async () => {
    const playlistWithoutTargets = { ...validPlaylist, targetPlaylists: [] };
    await withConfigFile(
        { playlists: [playlistWithoutTargets] },
        async (path) => {
            await assert.rejects(() => getSyncConfig(path));
        },
    );
});
