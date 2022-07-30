import { readFile } from 'fs/promises';
import { object, array, string } from 'yup';

import { Playlist, MusicServiceTypes } from '../entities';

export interface PlaylistConfig {
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
    syncConfigPath: string,
): Promise<SyncConfig> {
    const config = await readConfigFile(syncConfigPath);
    await validateConfig(config);

    return config;
}

async function readConfigFile(syncConfigPath: string): Promise<SyncConfig> {
    const fileData = await readFile(syncConfigPath);

    return JSON.parse(fileData.toString());
}

async function validateConfig(config: SyncConfig): Promise<void> {
    await SyncConfigSchema.validate(config);
}
