import { readFile } from 'fs/promises';
import { object, array, string } from 'yup';

import { ConfigService } from '../services';
import { IConfig } from './config';
import { Playlist } from '../entities/playlist.entity';
import { MusicServiceTypes } from '../entities/music-service.type';

interface PlaylistConfig {
    type: MusicServiceTypes;
    metadata: Playlist;
    excludedTrackIds: ReadonlyArray<string>;
    targetPlaylists: Omit<
        PlaylistConfig,
        'excludedTrackIds' | 'targetPlaylists'
    >[];
}

export interface SyncConfig {
    playlists: PlaylistConfig[];
}

const MusicServiceTypeSchema = string()
    .oneOf(Object.values(MusicServiceTypes))
    .defined();

const MetadataSchema = object({
    id: string().required(),
    userName: string().optional(),
}).required();

const SyncConfigSchema = object({
    playlists: array()
        .of(
            object({
                type: MusicServiceTypeSchema,
                metadata: MetadataSchema,
                excludedTrackIds: array().of(string()).optional(),
                targetPlaylists: array().of(
                    object({
                        type: MusicServiceTypeSchema,
                        metadata: MetadataSchema,
                    }),
                ),
            }),
        )
        .required(),
});

export async function getSyncConfig(
    configService: ConfigService<IConfig>,
): Promise<SyncConfig> {
    const config = await readConfigFile(configService);
    await validateConfig(config);

    return config;
}

async function readConfigFile(
    configService: ConfigService<IConfig>,
): Promise<SyncConfig> {
    const fileData = await readFile(configService.get('syncConfigPath'));

    return JSON.parse(fileData.toString());
}

async function validateConfig(config: SyncConfig): Promise<void> {
    await SyncConfigSchema.validate(config);
}
