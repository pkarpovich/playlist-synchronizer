import { join } from 'path';
import { Low, JSONFile } from 'lowdb';

export class LocalDbService<T> {
    private db: Low<T>;

    constructor() {
        const file = join('db.json');
        const adapter = new JSONFile<T>(file);
        this.db = new Low(adapter);
    }

    async start(initialData: T): Promise<void> {
        await this.db.read();

        this.db.data ||= initialData;
    }

    async save(): Promise<void> {
        return this.db.read();
    }

    async load(): Promise<void> {
        return this.db.read();
    }

    get(): T | null {
        return this.db.data;
    }

    async set(newValue: T): Promise<T | null> {
        this.db.data = newValue;
        await this.save();

        return this.db.data;
    }
}
