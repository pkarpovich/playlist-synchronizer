import { DbService, TrackMapKey, TrackMapRecord } from './db.service.js';
import { LogService } from './log.service.js';
import { SpotifyService } from './music-providers/spotify.service.js';
import { MusicServiceTypes, Track } from '../entities.js';

const NegativeRetryIntervalMs = 24 * 60 * 60 * 1000;
const TargetType = MusicServiceTypes.SPOTIFY;

export type TrackMappingResult = {
    mapping: Map<string, string>;
    skipped: number;
};

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
    ): Promise<TrackMappingResult> {
        const mapping = new Map<string, string>();
        let skipped = 0;

        for (const track of sourceTracks) {
            if (!track.id) {
                continue;
            }

            const key = {
                sourceType,
                sourceId: track.id,
                targetType: TargetType,
            };

            if (this.dbService.getTrackMap(key)?.skippedAt) {
                skipped += 1;
                continue;
            }

            const targetUri = await this.resolveOne(key, track);
            if (!targetUri) {
                continue;
            }

            mapping.set(track.id, targetUri);
        }

        return { mapping, skipped };
    }

    private async resolveOne(
        key: TrackMapKey,
        track: Track,
    ): Promise<string | null> {
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
            this.dbService.setTrackMiss(key, track.name, triedAt);
            this.logService.warn(
                `Track ${track.name} by ${track.artists.join(', ')} (${key.sourceType} ${key.sourceId}) not found in ${TargetType}`,
            );
            return null;
        }

        this.dbService.setTrackResolution(
            key,
            {
                sourceName: track.name,
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
