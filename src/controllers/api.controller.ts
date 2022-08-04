import express from 'express';
import { SpotifyController } from './spotify.controller';
import { HttpService } from '../services';
import { HealthController } from './health.controller';

export function initApiController(
    spotifyController: SpotifyController,
    healthController: HealthController,
): express.Router {
    const router = HttpService.newRouter();
    const spotifyRouter = spotifyController.getRoutes();
    const healthRouter = healthController.getRoutes();

    router.use('/spotify', spotifyRouter);
    router.use('/health', healthRouter);

    return router;
}
