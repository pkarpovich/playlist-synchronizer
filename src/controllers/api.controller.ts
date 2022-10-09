import express from 'express';
import { SpotifyController } from './spotify.controller.js';
import { HealthController } from './health.controller.js';
import { HttpService } from '../services.js';

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
