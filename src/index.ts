import { getSyncConfig } from './config';
import { initContainer } from './container';
import { cleanup } from './utils/cleanup';
import { LoggerContext } from './services';

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

async function startSync() {
    syncService.resetStatistics();

    for (let playlistConfig of syncConfig.playlists) {
        const loggerCtx: LoggerContext = {
            scope: logService.createScope(playlistConfig.metadata.name),
        };

        logService.info(
            `Start sync ${playlistConfig.metadata.name} playlist`,
            loggerCtx,
        );

        await syncService.sync(playlistConfig, loggerCtx);
    }
}

for (let playlistConfig of syncConfig.playlists) {
    cronService.addJob({
        pattern: configService.get('jobSettings.pattern'),
        cb: () => startSync(),
        startNow: true,
    });
}

cleanup(() => {
    cronService.stopAllJobs();
});
