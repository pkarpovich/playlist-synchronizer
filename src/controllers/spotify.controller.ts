import express from 'express';
import {
    CronService,
    HttpService,
    LogService,
    SpotifyAuthService,
} from '../services.js';
import { BaseController } from './base.controller.js';

function readQueryParam(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
}

function sanitizeForLog(value: string): string {
    return value.replace(/[^\w-]/g, '').slice(0, 64);
}

export class SpotifyController implements BaseController {
    constructor(
        private readonly spotifyAuthService: SpotifyAuthService,
        private readonly cronService: CronService,
        private readonly logService: LogService,
    ) {}

    getRoutes(): express.Router {
        const router = HttpService.newRouter();

        router.get('/callback', this.authCallback.bind(this));

        return router;
    }

    async authCallback(
        req: express.Request,
        res: express.Response,
    ): Promise<void> {
        const authError = readQueryParam(req.query.error);

        if (authError) {
            this.logService.error(
                `Spotify authorization was denied: ${sanitizeForLog(authError)}`,
            );
            res.status(400).send('Spotify authorization was denied');
            return;
        }

        const code = readQueryParam(req.query.code);

        if (!code) {
            this.logService.error(
                'Spotify callback carried no authorization code',
            );
            res.status(400).send('Missing authorization code');
            return;
        }

        try {
            await this.spotifyAuthService.exchangeCode(
                code,
                readQueryParam(req.query.state),
            );
        } catch (error) {
            this.logService.error(
                `Spotify authorization exchange failed: ${String(error)}`,
            );
            res.status(400).send('Spotify authorization failed');
            return;
        }

        this.cronService.triggerAllJobs();
        this.logService.success('Spotify authorization was successful');

        res.status(200).send('OK');
    }
}
