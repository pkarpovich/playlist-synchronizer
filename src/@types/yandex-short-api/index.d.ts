// foo.d.ts
declare module 'yandex-short-api' {
    type Artist = {
        name: string;
    };

    type Track = {
        id: string;
        title: string;
        artists: Artist[];
    };

    type Playlist = {
        tracks: Track[];
    };

    class YandexMusicApi {
        async getPlaylist(
            userName: string,
            playlistId: string,
        ): Promise<Playlist>;
    }
}
