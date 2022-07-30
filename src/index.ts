import {
    ConfigService,
    YandexMusicService,
    LocalDbService,
    SpotifyService,
    HttpService,
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

    // const yandexMusicService = new YandexMusicService();
    const spotifyService = new SpotifyService(db, configService);
    await spotifyService.initializeClient();

    new SpotifyController(spotifyService, http);

    // const originalTracks = await yandexMusicService.getPlaylistTracks({
    //     playlistId: originalPlaylist.playlistId,
    //     userName: originalPlaylist.userId,
    // });
    //
    // const spotifyTrackIds: string[] = (
    //     await Promise.all(
    //         originalTracks.map((track) =>
    //             spotifyService.searchTrackByName(track.name, track.artist),
    //         ),
    //     )
    // ).map((t) => t.id as string);
    //
    // await spotifyService.addTracksIntoPlaylist(
    //     spotifyTrackIds,
    //     destinationPlaylist.playlistId,
    // );

    // const destinationTracks = await spotifyService.getPlaylistTracks({
    //     playlistId: destinationPlaylist.playlistId,
    // });
    // console.log(originalTracks);
})();
