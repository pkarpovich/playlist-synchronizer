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
}

const DEFAULT_SYNC_CONFIG_PATH = './config/sync.config.json';
const DEFAULT_JOB_CRON_PATTERN = '@hourly';
const DEFAULT_DB_PATH = './db/db.json';

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
} as IConfig;
