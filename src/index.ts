import {
    ConfigService,
    YandexMusicService,
    LocalDbService,
    SpotifyService,
} from './services';
import { AuthStore } from './entities';

import { Config, IConfig } from './config';

const DEFAULT_AUTH_STORE: AuthStore = {
    refreshToken: '',
};

(async function () {
    const configService = new ConfigService<IConfig>(Config);
    const db = new LocalDbService<AuthStore>(DEFAULT_AUTH_STORE);

    await db.start();

    const yandexMusicService = new YandexMusicService();
    const spotifyService = new SpotifyService(db, configService);
    await spotifyService.initializeClient();

    const originalPlaylist = {
        userId: configService.get('yandex.userId'),
        playlistId: configService.get('yandex.playlistId'),
    };

    const originalTracks = await yandexMusicService.getPlaylistTracks(
        originalPlaylist.userId,
        originalPlaylist.playlistId,
    );
    console.log(originalTracks);
})();
