import { HttpService, SpotifyService } from '../services';
import express from 'express';

export class SpotifyController {
    constructor(private readonly spotifyService: SpotifyService) {}

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

        res.status(200).send('OK');
    }
}
