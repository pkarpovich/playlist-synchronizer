import * as process from 'process';
import dotenv from 'dotenv';
dotenv.config();

export interface IConfig {
    yandex: {
        userId: string;
        playlistId: string;
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

export const Config = {
    yandex: {
        userId: process.env.YANDEX_USER_ID,
        playlistId: process.env.YANDEX_PLAYLIST_ID,
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
