import { HttpService, SpotifyService } from '../services';
import express from 'express';

export class SpotifyController {
    constructor(
        private readonly spotifyService: SpotifyService,
        private readonly httpService: HttpService,
    ) {
        const router = this.httpService.newRouter();

        router.get('/callback', this.authCallback.bind(this));

        this.httpService.initRoutes('/spotify', router);
    }

    async authCallback(
        req: express.Request,
        res: express.Response,
    ): Promise<void> {
        const code = req.query.code as string;

        await this.spotifyService.authorizationCodeGrant(code);

        res.status(200).send('OK');
    }
}
