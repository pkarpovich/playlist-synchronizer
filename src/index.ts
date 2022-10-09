import { getSyncConfig } from './config.js';
import { initContainer } from './container.js';
import { LoggerContext } from './services.js';
import { cleanup } from './utils.js';

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

    for (const playlistConfig of syncConfig.playlists) {
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

cronService.addJob({
    pattern: configService.get('jobSettings.pattern'),
    cb: () => startSync(),
    startNow: true,
});

cleanup(() => {
    cronService.stopAllJobs();
});
