import * as process from 'process';
import dotenv from 'dotenv';
dotenv.config();

export interface IConfig {
    syncConfigPath: string;

    spotify: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };
    http: {
        port: number;
    };
}

export const Config = {
    syncConfigPath: process.env.SYNC_CONFIG_PATH || './sync-config.json',

    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    },
    http: {
        port: Number(process.env.HTTP_PORT),
    },
} as IConfig;
