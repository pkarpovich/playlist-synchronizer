export interface Store {
    youtubeMusic: {
        token: {
            access_token: string;
            expires_in: number;
            refresh_token: string;
            scope: string;
            token_type: string;
            expires_date: string;
        } | null;
    };
    spotify: {
        refreshToken: string;
    };
}
