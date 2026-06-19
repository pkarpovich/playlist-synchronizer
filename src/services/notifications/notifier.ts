import { IConfig } from '../../config.js';
import { LastRun } from '../../entities.js';
import { ConfigService } from '../config.service.js';
import { LogService } from '../log.service.js';
import { renderDigest } from './render-digest.js';
import { summarizeRun } from './sync-summary.js';

const TIMEOUT_MS = 5000;

export type RelayFetch = (
    url: string,
    init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status'>>;

export interface Notifier {
    notify(lastRun: LastRun | null): Promise<void>;
}

export class NoopNotifier implements Notifier {
    notify(): Promise<void> {
        return Promise.resolve();
    }
}

export class RelayNotifier implements Notifier {
    constructor(
        private readonly logService: LogService,
        private readonly configService: ConfigService<IConfig>,
        private readonly fetchFn: RelayFetch,
    ) {}

    async notify(lastRun: LastRun | null): Promise<void> {
        try {
            const summary = summarizeRun(lastRun);

            if (summary === null) {
                return;
            }

            const url = this.configService.get('notify.url');
            const secret = this.configService.get('notify.secret');

            const resp = await this.fetchFn(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Secret': secret,
                },
                body: JSON.stringify({
                    message: renderDigest(summary),
                    parse_mode: 'md',
                }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            if (!resp.ok) {
                this.logService.error(`notify failed: HTTP ${resp.status}`);
            }
        } catch (error) {
            const reason =
                error instanceof Error ? error.message : String(error);
            this.logService.error(`notify failed: ${reason}`);
        }
    }
}
