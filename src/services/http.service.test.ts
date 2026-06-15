import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { Router } from 'express';

import { HttpService } from './http.service.js';
import { ConfigService } from './config.service.js';
import { LogService } from './log.service.js';
import { IConfig } from '../config.js';

test('handleError catches rejections from an async route (express 5)', async () => {
    const errors: Error[] = [];
    const logService = {
        error: (err: Error) => errors.push(err),
    } as unknown as LogService;
    const configService = {
        get: () => 0,
    } as unknown as ConfigService<IConfig>;

    const router = Router();
    router.get('/callback', async () => {
        throw new Error('async failure');
    });

    const httpService = new HttpService(logService, configService, router);

    const app = express();
    app.use('/', router);
    app.use(httpService.handleError);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
        const res = await fetch(`http://127.0.0.1:${port}/callback`);

        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), {
            error: 'Internal Server Error',
            code: 500,
        });
        assert.equal(errors.length, 1);
        assert.equal(errors[0]?.message, 'async failure');
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
