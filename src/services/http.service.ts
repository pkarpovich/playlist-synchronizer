import express from 'express';

import { ConfigService } from './config.service';
import { IConfig } from '../config';

export class HttpService {
    private readonly app: express.Application;

    constructor(private readonly congigService: ConfigService<IConfig>) {
        this.app = express();
    }

    newRouter(): express.Router {
        return express.Router();
    }

    initRoutes(routePrefix: string, router: express.Router): void {
        this.app.use(routePrefix, router);
    }

    start(cb?: () => void): void {
        const port = this.congigService.get('http.port');

        this.app.listen(
            port,
            cb ? cb : () => console.log(`Listening on port ${port}`),
        );
    }
}
