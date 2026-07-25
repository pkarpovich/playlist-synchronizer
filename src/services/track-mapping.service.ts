import { DbService, TrackMapRecord } from './db.service.js';
import { LogService } from './log.service.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { MusicServiceTypes, Track } from '../entities.js';

const NegativeRetryIntervalMs = 24 * 60 * 60 * 1000;
const TargetType = MusicServiceTypes.SPOTIFY;

export class TrackMappingService {
    constructor(
        private readonly dbService: DbService,
        private readonly spotifyService: SpotifyService,
        private readonly logService: LogService,
        private readonly now: () => number,
    ) {}

    async resolve(
        sourceType: MusicServiceTypes,
        sourceTracks: Track[],
    ): Promise<Map<string, string>> {
        const mapping = new Map<string, string>();

        for (const track of sourceTracks) {
            if (!track.id) {
                continue;
            }

            const targetUri = await this.resolveOne(
                sourceType,
                track.id,
                track,
            );
            if (!targetUri) {
                continue;
            }

            mapping.set(track.id, targetUri);
        }

        return mapping;
    }

    private async resolveOne(
        sourceType: MusicServiceTypes,
        sourceId: string,
        track: Track,
    ): Promise<string | null> {
        const key = { sourceType, sourceId, targetType: TargetType };
        const existing = this.dbService.getTrackMap(key);

        if (existing?.targetUri) {
            return existing.targetUri;
        }

        if (existing && !this.isRetryDue(existing)) {
            return null;
        }

        const resolved = await this.spotifyService.resolveTrack(track);
        const triedAt = this.now();

        if (!resolved) {
            this.dbService.setTrackMiss(key, triedAt);
            this.logService.warn(
                `Track ${track.name} by ${track.artists.join(', ')} not found in ${TargetType}`,
            );
            return null;
        }

        this.dbService.setTrackResolution(
            key,
            {
                targetUri: resolved.uri,
                isrc: resolved.isrc,
                durationMs: resolved.durationMs,
            },
            triedAt,
        );

        return resolved.uri;
    }

    private isRetryDue({ lastTriedAt }: TrackMapRecord): boolean {
        if (lastTriedAt === null) {
            return true;
        }

        return this.now() - lastTriedAt >= NegativeRetryIntervalMs;
    }
}
