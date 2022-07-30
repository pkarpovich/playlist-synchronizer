import { getSyncConfig } from './config';
import { initContainer } from './container';

(async function () {
    const { configService, httpService, authStore, syncService } =
        initContainer().cradle;

    await authStore.start();
    httpService.start();

    const syncConfigPath: string = configService.get('syncConfigPath');
    const syncConfig = await getSyncConfig(syncConfigPath);

    for (let playlistConfig of syncConfig.playlists) {
        await syncService.sync(playlistConfig);
    }
})();
