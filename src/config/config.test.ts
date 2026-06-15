import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { readYandexMusicConfig } from './config.js';

test('readYandexMusicConfig falls back to defaults when env is empty', () => {
    const config = readYandexMusicConfig({});

    assert.equal(config.baseUrl, 'https://api.music.yandex.net');
    assert.equal(config.proxyUrl, '');
});

test('readYandexMusicConfig reads values from env when provided', () => {
    const config = readYandexMusicConfig({
        YANDEX_API_BASE_URL: 'https://example.test',
        YANDEX_API_PROXY: 'socks5h://127.0.0.1:1080',
    });

    assert.equal(config.baseUrl, 'https://example.test');
    assert.equal(config.proxyUrl, 'socks5h://127.0.0.1:1080');
});

test('readYandexMusicConfig treats empty proxy string as empty', () => {
    const config = readYandexMusicConfig({ YANDEX_API_PROXY: '' });

    assert.equal(config.proxyUrl, '');
});
