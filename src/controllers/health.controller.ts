import express from 'express';

import { BaseController } from './base.controller';
import { HttpService, SyncService } from '../services';

export class HealthController implements BaseController {
    constructor(private readonly syncService: SyncService) {}

    getRoutes(): express.Router {
        const router = HttpService.newRouter();

        router.get('/', this.healthCheck.bind(this));

        return router;
    }

    async healthCheck(
        req: express.Request,
        res: express.Response,
    ): Promise<void> {
        res.json({ status: 'UP', statistics: this.syncService.statistics });
    }
}
