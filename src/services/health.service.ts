import { LastRun, RunStatus } from '../entities.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { SyncService } from './sync.service.js';

export type HealthStatus = RunStatus | 'no-run';

export type HealthSnapshot = {
    status: HealthStatus;
    lastSyncAt: string | null;
    ageSeconds: number | null;
    spotifyReady: boolean;
    lastRun: LastRun | null;
};

export class HealthService {
    constructor(
        private readonly syncService: SyncService,
        private readonly spotifyService: SpotifyService,
        private readonly now: () => number,
    ) {}

    snapshot(): HealthSnapshot {
        const lastRun = this.syncService.lastRun;

        if (!lastRun) {
            return {
                status: 'no-run',
                lastSyncAt: null,
                ageSeconds: null,
                spotifyReady: this.spotifyService.isReady,
                lastRun: null,
            };
        }

        return {
            status: lastRun.status,
            lastSyncAt: new Date(lastRun.finishedAt).toISOString(),
            ageSeconds: Math.floor((this.now() - lastRun.finishedAt) / 1000),
            spotifyReady: this.spotifyService.isReady,
            lastRun,
        };
    }
}
