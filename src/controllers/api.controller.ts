import express from 'express';
import { SpotifyController } from './spotify.controller';
import { HttpService } from '../services';

export function initApiController(
    spotifyController: SpotifyController,
): express.Router {
    const router = HttpService.newRouter();
    const spotifyRouter = spotifyController.getRoutes();

    router.use('/spotify', spotifyRouter);

    return router;
}
