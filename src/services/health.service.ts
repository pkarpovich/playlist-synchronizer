import { LastRun, RunStatus } from '../entities.js';
import { DbService, TrackMapCounts } from './db.service.js';
import {
    SpotifyAuthService,
    SpotifyAuthState,
} from './music-providers/spotify-auth.service.js';
import { SyncService } from './sync.service.js';

export type HealthStatus = RunStatus | 'no-run';

export type HealthSnapshot = {
    status: HealthStatus;
    lastSyncAt: string | null;
    ageSeconds: number | null;
    spotify: { state: SpotifyAuthState };
    mapping: TrackMapCounts;
    lastRun: LastRun | null;
};

export class HealthService {
    constructor(
        private readonly syncService: SyncService,
        private readonly spotifyAuthService: SpotifyAuthService,
        private readonly dbService: DbService,
        private readonly now: () => number,
    ) {}

    snapshot(): HealthSnapshot {
        const lastRun = this.syncService.lastRun;
        const spotify = { state: this.spotifyAuthService.state };
        const mapping = this.dbService.countTrackMap();

        if (!lastRun) {
            return {
                status: 'no-run',
                lastSyncAt: null,
                ageSeconds: null,
                spotify,
                mapping,
                lastRun: null,
            };
        }

        return {
            status: lastRun.status,
            lastSyncAt: new Date(lastRun.finishedAt).toISOString(),
            ageSeconds: Math.floor((this.now() - lastRun.finishedAt) / 1000),
            spotify,
            mapping,
            lastRun,
        };
    }
}
