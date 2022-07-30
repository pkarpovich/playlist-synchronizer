import { getSyncConfig } from './config';
import { initContainer } from './container';
import { cleanup } from './utils/cleanup';

const { configService, httpService, authStore, syncService, cronService } =
    initContainer().cradle;

await authStore.start();
httpService.start();

const syncConfigPath: string = configService.get('syncConfigPath');
const syncConfig = await getSyncConfig(syncConfigPath);

for (let playlistConfig of syncConfig.playlists) {
    cronService.addJob({
        pattern: configService.get('jobSettings.pattern'),
        cb: () => syncService.sync(playlistConfig),
        startNow: true,
    });
}

cleanup(() => {
    cronService.stopAllJobs();
});
