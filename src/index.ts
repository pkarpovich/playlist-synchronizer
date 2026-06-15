import { getSyncConfig } from './config.js';
import { initContainer } from './container.js';
import { cleanup } from './utils.js';

const container = await initContainer();
const { spotifyService, configService, httpService, syncService, cronService } =
    container.cradle;

httpService.start();
await spotifyService.initializeClient();

const syncConfigPath: string = configService.get('syncConfigPath');
const syncConfig = await getSyncConfig(syncConfigPath);

cronService.addJob({
    pattern: configService.get('jobSettings.pattern'),
    cb: () => syncService.syncAll(syncConfig),
    startNow: true,
});

cleanup(() => {
    cronService.stopAllJobs();
});
