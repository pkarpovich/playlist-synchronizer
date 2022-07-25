import { Config, IConfig } from './config';
import { ConfigService, YandexMusicService } from './services';

(async function () {
    const configService = new ConfigService<IConfig>(Config);
    const yandexMusicService = new YandexMusicService();

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
