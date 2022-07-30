import express from 'express';

import { ConfigService } from './config.service';
import { IConfig } from '../config';

export class HttpService {
    private readonly app: express.Application;

    constructor(
        private readonly configService: ConfigService<IConfig>,
        private readonly apiRouter: express.Router,
    ) {
        this.app = express();
    }

    static newRouter(): express.Router {
        return express.Router();
    }

    start(cb?: () => void): void {
        const port = this.configService.get('http.port');

        this.app.use('/', this.apiRouter);

        this.app.listen(
            port,
            cb ? cb : () => console.log(`Listening on port ${port}`),
        );
    }
}
