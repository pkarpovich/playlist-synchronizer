import { getSyncConfig } from './config';
import { initContainer } from './container';
import { cleanup } from './utils/cleanup';

const {
    spotifyService,
    configService,
    httpService,
    authStore,
    syncService,
    cronService,
    logService,
} = initContainer().cradle;

await authStore.start();
httpService.start();
await spotifyService.initializeClient();

const syncConfigPath: string = configService.get('syncConfigPath');
const syncConfig = await getSyncConfig(syncConfigPath);

for (let playlistConfig of syncConfig.playlists) {
    logService.info(`Start sync ${playlistConfig.metadata.name} playlist`);

    cronService.addJob({
        pattern: configService.get('jobSettings.pattern'),
        cb: () => syncService.sync(playlistConfig),
        startNow: true,
    });
}

cleanup(() => {
    cronService.stopAllJobs();
});
