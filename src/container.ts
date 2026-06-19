import {
    asClass,
    AwilixContainer,
    createContainer,
    InjectionMode,
    asFunction,
    asValue,
} from 'awilix';
import express from 'express';
import {
    ConfigService,
    CronService,
    FetchFn,
    HealthService,
    HttpService,
    LocalDbService,
    LogService,
    NoopNotifier,
    Notifier,
    RelayNotifier,
    SpotifyService,
    SyncService,
    YandexMusicService,
} from './services.js';
import { Config, IConfig } from './config.js';
import { AuthStore } from './entities.js';
import {
    initApiController,
    SpotifyController,
    HealthController,
} from './controllers.js';

const defaultAuthStore: AuthStore = {
    refreshToken: '',
};

interface Container {
    logService: LogService;
    configService: ConfigService<IConfig>;
    authStore: LocalDbService<AuthStore>;
    httpService: HttpService;
    cronService: CronService;
    fetchFn: FetchFn;
    now: () => number;
    yandexMusicService: YandexMusicService;
    spotifyService: SpotifyService;
    healthService: HealthService;
    spotifyController: SpotifyController;
    healthController: HealthController;
    apiRouter: express.Router;
    syncService: SyncService;
    notifier: Notifier;
}

function initNotifier(
    logService: LogService,
    configService: ConfigService<IConfig>,
    fetchFn: FetchFn,
): Notifier {
    if (configService.get('notify.url')) {
        return new RelayNotifier(logService, configService, fetchFn);
    }
    return new NoopNotifier();
}

export async function initContainer(): Promise<AwilixContainer<Container>> {
    const container = createContainer<Container>({
        injectionMode: InjectionMode.CLASSIC,
    });

    container.register({
        logService: asClass(LogService).singleton(),
        configService: asClass(ConfigService<IConfig>)
            .inject(() => ({ config: Config }))
            .singleton(),
        httpService: asClass(HttpService).singleton(),
        cronService: asClass(CronService).singleton(),
        fetchFn: asValue<FetchFn>(globalThis.fetch),
        now: asValue<() => number>(() => Date.now()),
        yandexMusicService: asClass(YandexMusicService).singleton(),
        spotifyService: asClass(SpotifyService).singleton(),
        healthService: asClass(HealthService).singleton(),
        healthController: asClass(HealthController).singleton(),
        spotifyController: asClass(SpotifyController).singleton(),
        apiRouter: asFunction(initApiController).singleton(),
        notifier: asFunction(initNotifier).singleton(),
        syncService: asClass(SyncService).singleton(),
    });

    const dbPath = container.cradle.configService.get('dbPath');
    const authStoreDb = await LocalDbService.create(defaultAuthStore, dbPath);

    container.register({
        authStore: asFunction(
            () => new LocalDbService<AuthStore>(authStoreDb),
        ).singleton(),
    });

    return container;
}
