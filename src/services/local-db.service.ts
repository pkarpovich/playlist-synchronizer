import { mkdir } from 'fs/promises';
import { join } from 'node:path';
import { Low } from 'lowdb';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { JSONFile } from 'lowdb/node';
import { ConfigService } from './config.service.js';
import { IConfig } from '../config.js';

export class LocalDbService<T> {
    private db: Low<T>;

    constructor(
        private readonly initialData: T,
        private readonly configService: ConfigService<IConfig>,
    ) {
        const dbPath = this.configService.get('dbPath');

        const file = join(dbPath);
        const fileFolderPath = file.split('/').slice(0, -1).join('/');
        if (fileFolderPath) {
            this.createFolderIfNeeded(fileFolderPath);
        }

        const adapter = new JSONFile<T>(file);
        this.db = new Low(adapter);
    }

    async start(): Promise<void> {
        await this.load();

        this.db.data ||= this.initialData;
    }

    async save(): Promise<void> {
        return this.db.write();
    }

    async load(): Promise<void> {
        return this.db.read();
    }

    get(): T {
        return this.db.data || this.initialData;
    }

    async set(newValue: T): Promise<T | null> {
        this.db.data = newValue;
        await this.save();

        return this.db.data;
    }

    private async createFolderIfNeeded(path: string): Promise<void> {
        await mkdir(path, { recursive: true });
    }
}
