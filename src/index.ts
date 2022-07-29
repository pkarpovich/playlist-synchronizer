import {
    ConfigService,
    YandexMusicService,
    LocalDbService,
    SpotifyService,
    HttpService,
} from './services';
import { AuthStore } from './entities';

import { Config, IConfig } from './config';
import { SpotifyController } from './controllers';

const DEFAULT_AUTH_STORE: AuthStore = {
    refreshToken: '',
};

(async function () {
    const configService = new ConfigService<IConfig>(Config);
    const db = new LocalDbService<AuthStore>(DEFAULT_AUTH_STORE);
    const http = new HttpService(configService);

    await db.start();
    http.start();

    const yandexMusicService = new YandexMusicService();
    const spotifyService = new SpotifyService(db, configService);
    await spotifyService.initializeClient();

    new SpotifyController(spotifyService, http);

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
