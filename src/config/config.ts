import * as process from 'process';
import dotenv from 'dotenv';
dotenv.config();

export interface IConfig {
    dbPath: string;
    syncConfigPath: string;

    jobSettings: {
        pattern: string;
    };

    spotify: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };

    http: {
        port: number;
    };

    yandexMusic: {
        baseUrl: string;
        proxyUrl: string;
    };
}

const DEFAULT_SYNC_CONFIG_PATH = './config/sync.config.json';
const DEFAULT_JOB_CRON_PATTERN = '@hourly';
const DEFAULT_DB_PATH = './db/db.json';
const DEFAULT_YANDEX_API_BASE_URL = 'https://api.music.yandex.net';

export function readYandexMusicConfig(
    env: NodeJS.ProcessEnv,
): IConfig['yandexMusic'] {
    return {
        baseUrl: env.YANDEX_API_BASE_URL || DEFAULT_YANDEX_API_BASE_URL,
        proxyUrl: env.YANDEX_API_PROXY || '',
    };
}

export const Config = {
    dbPath: process.env.DB_PATH || DEFAULT_DB_PATH,
    syncConfigPath: process.env.SYNC_CONFIG_PATH || DEFAULT_SYNC_CONFIG_PATH,

    jobSettings: {
        pattern: process.env.JOB_CRON_PATTERN || DEFAULT_JOB_CRON_PATTERN,
    },

    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    },

    http: {
        port: Number(process.env.HTTP_PORT),
    },

    yandexMusic: readYandexMusicConfig(process.env),
} as IConfig;
