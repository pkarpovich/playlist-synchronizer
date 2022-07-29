import { ConfigService, YandexMusicService, LocalDbService } from './services';
import { AuthStore } from './entities';

import { Config, IConfig } from './config';

const DEFAULT_AUTH_STORE: AuthStore = {
    refreshToken: '',
};

(async function () {
    const configService = new ConfigService<IConfig>(Config);
    const yandexMusicService = new YandexMusicService();
    const db = new LocalDbService<AuthStore>();

    await db.start(DEFAULT_AUTH_STORE);

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
