import { Token } from 'libmuse';

export interface YoutubeMusic {
    token: Token | null;

    [key: string]: unknown;
}

export interface Store {
    youtubeMusic: YoutubeMusic;
    spotify: {
        refreshToken: string;
    };
}
