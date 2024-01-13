import { Store } from 'libmuse';

import { LocalDbService } from '../../local-db.service.js';
import {
    Store as LocalBdStore,
    YoutubeMusic,
} from '../../../entities/auth-store.entity.js';

export class YoutubeMusicStore extends Store {
    store: YoutubeMusic;

    constructor(private readonly localBdStore: LocalDbService<LocalBdStore>) {
        super();

        const { youtubeMusic } = this.localBdStore.get();
        this.store = youtubeMusic;
    }

    get<T>(key: string): T | null {
        return (this.store[key] as T) ?? null;
    }

    set(key: string, value: unknown): void {
        this.store[key] = value;

        this.save();
    }

    delete(key: string): void {
        delete this.store[key];

        this.save();
    }

    async save(): Promise<void> {
        const localBdStore = this.localBdStore.get();
        await this.localBdStore.set({
            ...localBdStore,
            youtubeMusic: this.store,
        });
    }
}
