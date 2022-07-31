import express from 'express';
import helmet from 'helmet';

import { ConfigService } from './config.service';
import { LogService } from './log.service';
import { IConfig } from '../config';

export class HttpService {
    private readonly app: express.Application;

    constructor(
        private readonly logService: LogService,
        private readonly configService: ConfigService<IConfig>,
        private readonly apiRouter: express.Router,
    ) {
        this.app = express();
        this.app.use(helmet());
    }

    static newRouter(): express.Router {
        return express.Router();
    }

    start(cb?: () => void): void {
        const port = this.configService.get('http.port');

        this.app.use('/', this.apiRouter);

        this.app.listen(
            port,
            cb
                ? cb
                : () =>
                      this.logService.info(
                          `Http server listening on port ${port}`,
                      ),
        );
    }
}
