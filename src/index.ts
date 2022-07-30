import {
    ConfigService,
    YandexMusicService,
    LocalDbService,
    SpotifyService,
    HttpService,
    SyncService,
} from './services';
import { AuthStore } from './entities';

import { Config, getSyncConfig, IConfig } from './config';
import { SpotifyController } from './controllers';

const DEFAULT_AUTH_STORE: AuthStore = {
    refreshToken: '',
};

(async function () {
    const configService = new ConfigService<IConfig>(Config);
    const syncConfig = await getSyncConfig(configService);
    const db = new LocalDbService<AuthStore>(DEFAULT_AUTH_STORE);
    const http = new HttpService(configService);

    await db.start();
    http.start();

    const yandexMusicService = new YandexMusicService();
    const spotifyService = new SpotifyService(db, configService);
    await spotifyService.initializeClient();

    new SpotifyController(spotifyService, http);

    const syncService = new SyncService(yandexMusicService, spotifyService);

    for (let playlistConfig of syncConfig.playlists) {
        await syncService.sync(playlistConfig);
    }
})();
