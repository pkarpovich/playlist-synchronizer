export interface YoutubeMusic {
    token: {
        access_token: string;
        expires_in: number;
        refresh_token: string;
        scope: string;
        token_type: string;
        expires_date: string;
    } | null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}

export interface Store {
    youtubeMusic: YoutubeMusic;
    spotify: {
        refreshToken: string;
    };
}
