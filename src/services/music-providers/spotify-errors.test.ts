import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
    classifyApiStatus,
    classifyTokenResponse,
    parseRetryAfter,
    readTokenErrorCode,
    SpotifyHttpError,
    SpotifyNotAuthorizedError,
} from './spotify-errors.js';

test('classifyTokenResponse detects an expired or revoked refresh token', () => {
    assert.equal(
        classifyTokenResponse(400, {
            error: 'invalid_grant',
            error_description: 'Refresh token revoked',
        }),
        'invalid-grant',
    );
});

test('classifyTokenResponse treats other 400 errors as configuration problems', () => {
    assert.equal(
        classifyTokenResponse(400, { error: 'invalid_client' }),
        'config-error',
    );
    assert.equal(
        classifyTokenResponse(400, { error: 'invalid_request' }),
        'config-error',
    );
    assert.equal(classifyTokenResponse(400, {}), 'config-error');
    assert.equal(classifyTokenResponse(400, null), 'config-error');
    assert.equal(classifyTokenResponse(400, 'invalid_grant'), 'config-error');
});

test('classifyTokenResponse treats rate limiting and server errors as transient', () => {
    assert.equal(classifyTokenResponse(429, {}), 'transient');
    assert.equal(classifyTokenResponse(500, {}), 'transient');
    assert.equal(classifyTokenResponse(502, {}), 'transient');
    assert.equal(
        classifyTokenResponse(503, { error: 'invalid_grant' }),
        'transient',
    );
});

test('classifyTokenResponse treats rejected credentials as a configuration problem', () => {
    assert.equal(
        classifyTokenResponse(401, { error: 'invalid_client' }),
        'config-error',
    );
    assert.equal(classifyTokenResponse(403, {}), 'config-error');
});

test('classifyApiStatus maps every api status to its action', () => {
    assert.equal(classifyApiStatus(401), 'refresh-retry');
    assert.equal(classifyApiStatus(403), 'no-retry');
    assert.equal(classifyApiStatus(404), 'no-retry');
    assert.equal(classifyApiStatus(429), 'retry-after');
    assert.equal(classifyApiStatus(500), 'backoff');
    assert.equal(classifyApiStatus(502), 'backoff');
    assert.equal(classifyApiStatus(504), 'backoff');
    assert.equal(classifyApiStatus(400), 'no-retry');
});

test('parseRetryAfter converts whole seconds and clamps the maximum', () => {
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(parseRetryAfter('60'), 60000);
    assert.equal(parseRetryAfter('999'), 60000);
    assert.equal(parseRetryAfter(' 3 '), 3000);
});

test('parseRetryAfter falls back to one second for unusable headers', () => {
    assert.equal(parseRetryAfter(null), 1000);
    assert.equal(parseRetryAfter(''), 1000);
    assert.equal(parseRetryAfter('abc'), 1000);
    assert.equal(parseRetryAfter('-5'), 1000);
    assert.equal(parseRetryAfter('1.5'), 1000);
    assert.equal(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT'), 1000);
});

test('readTokenErrorCode returns the code only for an object with a string error', () => {
    assert.equal(
        readTokenErrorCode({ error: 'invalid_client' }),
        'invalid_client',
    );
    assert.equal(readTokenErrorCode({ error: 42 }), null);
    assert.equal(readTokenErrorCode({}), null);
    assert.equal(readTokenErrorCode(null), null);
    assert.equal(readTokenErrorCode('invalid_client'), null);
});

test('SpotifyHttpError carries the status and the optional code', () => {
    const withCode = new SpotifyHttpError('forbidden', 403, 'access_denied');

    assert.ok(withCode instanceof Error);
    assert.equal(withCode.name, 'SpotifyHttpError');
    assert.equal(withCode.message, 'forbidden');
    assert.equal(withCode.status, 403);
    assert.equal(withCode.code, 'access_denied');
    assert.equal(new SpotifyHttpError('server error', 500).code, null);
});

test('SpotifyNotAuthorizedError is a named error', () => {
    const error = new SpotifyNotAuthorizedError('needs reauthorization');

    assert.ok(error instanceof Error);
    assert.equal(error.name, 'SpotifyNotAuthorizedError');
    assert.equal(error.message, 'needs reauthorization');
});
