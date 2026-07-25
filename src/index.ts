import { getSyncConfig, SyncConfig } from './config.js';
import { initContainer } from './container.js';
import { cleanup } from './utils.js';

const container = await initContainer();
const {
    logService,
    configService,
    dbService,
    httpService,
    cronService,
    spotifyAuthService,
    syncService,
} = container.cradle;

httpService.start();

const syncConfigPath: string = configService.get('syncConfigPath');
let syncConfig: SyncConfig;

try {
    syncConfig = await getSyncConfig(syncConfigPath);
} catch (error) {
    logService.error(
        `Failed to load the sync config from ${syncConfigPath}: ${String(error)}`,
    );
    process.exit(1);
}

await spotifyAuthService.initialize();

cronService.addJob({
    pattern: configService.get('jobSettings.pattern'),
    cb: () => syncService.syncAll(syncConfig),
    startNow: true,
});

cleanup(() => {
    cronService.stopAllJobs();
    dbService.close();
});
