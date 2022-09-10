import express from 'express';
import {
    CronService,
    HttpService,
    LogService,
    SpotifyService,
} from '../services.js';
import { BaseController } from './base.controller.js';

export class SpotifyController implements BaseController {
    constructor(
        private readonly spotifyService: SpotifyService,
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
        const code = req.query.code as string;

        await this.spotifyService.authorizationCodeGrant(code);
        this.cronService.triggerAllJobs();

        this.logService.success('Spotify authorization was successful');

        res.status(200).send('OK');
    }
}
