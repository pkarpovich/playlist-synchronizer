import * as process from 'process';
import dotenv from 'dotenv';
dotenv.config();

export interface IConfig {
    yandex: {
        userId: string;
        playlistId: string;
    };
}

export const Config = {
    yandex: {
        userId: process.env.YANDEX_USER_ID,
        playlistId: process.env.YANDEX_PLAYLIST_ID,
    },
} as IConfig;
