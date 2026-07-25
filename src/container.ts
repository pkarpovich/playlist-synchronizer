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
    DbService,
    DelayFn,
    FetchFn,
    HealthService,
    HttpService,
    LogService,
    NoopNotifier,
    Notifier,
    RelayNotifier,
    SpotifyAuthService,
    SpotifyService,
    SyncService,
    TrackMappingService,
    YandexMusicService,
} from './services.js';
import { Config, IConfig } from './config.js';
import {
    initApiController,
    SpotifyController,
    HealthController,
} from './controllers.js';

interface Container {
    logService: LogService;
    configService: ConfigService<IConfig>;
    dbService: DbService;
    httpService: HttpService;
    cronService: CronService;
    fetchFn: FetchFn;
    now: () => number;
    delayFn: DelayFn;
    yandexMusicService: YandexMusicService;
    spotifyAuthService: SpotifyAuthService;
    spotifyService: SpotifyService;
    trackMappingService: TrackMappingService;
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
        dbService: asClass(DbService).singleton(),
        httpService: asClass(HttpService).singleton(),
        cronService: asClass(CronService).singleton(),
        fetchFn: asValue<FetchFn>(globalThis.fetch),
        now: asValue<() => number>(() => Date.now()),
        delayFn: asValue<DelayFn>(
            (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        ),
        yandexMusicService: asClass(YandexMusicService).singleton(),
        spotifyAuthService: asClass(SpotifyAuthService).singleton(),
        spotifyService: asClass(SpotifyService).singleton(),
        trackMappingService: asClass(TrackMappingService).singleton(),
        healthService: asClass(HealthService).singleton(),
        healthController: asClass(HealthController).singleton(),
        spotifyController: asClass(SpotifyController).singleton(),
        apiRouter: asFunction(initApiController).singleton(),
        notifier: asFunction(initNotifier).singleton(),
        syncService: asClass(SyncService).singleton(),
    });

    return container;
}
