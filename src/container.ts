import {
    asClass,
    AwilixContainer,
    createContainer,
    InjectionMode,
    asFunction,
} from 'awilix';
import express from 'express';
import {
    ConfigService,
    CronService,
    HttpService,
    LocalDbService,
    LogService,
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
    yandexMusicService: YandexMusicService;
    spotifyService: SpotifyService;
    spotifyController: SpotifyController;
    healthController: HealthController;
    apiRouter: express.Router;
    syncService: SyncService;
}

export function initContainer(): AwilixContainer<Container> {
    const container = createContainer<Container>({
        injectionMode: InjectionMode.CLASSIC,
    });

    container.register({
        logService: asClass(LogService).singleton(),
        configService: asClass(ConfigService<IConfig>)
            .inject(() => ({ config: Config }))
            .singleton(),
        authStore: asClass(LocalDbService<AuthStore>)
            .inject(() => ({ initialData: defaultAuthStore }))
            .singleton(),
        httpService: asClass(HttpService).singleton(),
        cronService: asClass(CronService).singleton(),
        yandexMusicService: asClass(YandexMusicService).singleton(),
        spotifyService: asClass(SpotifyService).singleton(),
        healthController: asClass(HealthController).singleton(),
        spotifyController: asClass(SpotifyController).singleton(),
        apiRouter: asFunction(initApiController).singleton(),
        syncService: asClass(SyncService),
    });

    return container;
}
