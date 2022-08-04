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

for (let playlistConfig of syncConfig.playlists) {
    const loggerCtx: LoggerContext = {
        scope: logService.createScope(playlistConfig.metadata.name),
    };

    logService.info(
        `Start sync ${playlistConfig.metadata.name} playlist`,
        loggerCtx,
    );

    cronService.addJob({
        pattern: configService.get('jobSettings.pattern'),
        cb: () => syncService.sync(playlistConfig, loggerCtx),
        startNow: true,
    });
}

cleanup(() => {
    cronService.stopAllJobs();
});
