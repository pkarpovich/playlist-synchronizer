import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Router } from 'express';

import { HttpService } from './http.service.js';
import { ConfigService } from './config.service.js';
import { LogService } from './log.service.js';
import { IConfig } from '../config.js';

test('start() wires routes and forwards async rejections to the error handler (express 5)', async () => {
    const errors: Error[] = [];
    const logService = {
        error: (err: Error) => errors.push(err),
    } as unknown as LogService;
    const configService = {
        get: () => 0,
    } as unknown as ConfigService<IConfig>;

    const router = Router();
    router.get('/ok', (_req, res) => {
        res.json({ status: 'UP' });
    });
    router.get('/callback', async () => {
        throw new Error('async failure');
    });

    const httpService = new HttpService(logService, configService, router);

    const server = await new Promise<Server>((resolve) => {
        const s = httpService.start(() => resolve(s));
    });
    const { port } = server.address() as AddressInfo;

    try {
        const ok = await fetch(`http://127.0.0.1:${port}/ok`);
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { status: 'UP' });

        const failed = await fetch(`http://127.0.0.1:${port}/callback`);
        assert.equal(failed.status, 500);
        assert.deepEqual(await failed.json(), {
            error: 'Internal Server Error',
            code: 500,
        });
        assert.equal(errors.length, 1);
        assert.equal(errors[0]?.message, 'async failure');
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
