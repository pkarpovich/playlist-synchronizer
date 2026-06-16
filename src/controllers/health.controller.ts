import express from 'express';

import { BaseController } from './base.controller.js';
import { HealthService, HttpService } from '../services.js';

export class HealthController implements BaseController {
    constructor(private readonly healthService: HealthService) {}

    getRoutes(): express.Router {
        const router = HttpService.newRouter();

        router.get('/', this.healthCheck.bind(this));

        return router;
    }

    async healthCheck(
        req: express.Request,
        res: express.Response,
    ): Promise<void> {
        res.status(200).json(this.healthService.snapshot());
    }
}
