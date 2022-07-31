import { join } from 'path';
import { Low, JSONFile } from 'lowdb';
import { ConfigService } from './config.service';
import { IConfig } from '../config';

export class LocalDbService<T> {
    private db: Low<T>;

    constructor(
        private readonly initialData: T,
        private readonly configService: ConfigService<IConfig>,
    ) {
        const dbPath = configService.get('dbPath');

        const file = join(dbPath);
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
}
