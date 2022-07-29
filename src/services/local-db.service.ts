import { join } from 'path';
import { Low, JSONFile } from 'lowdb';

export class LocalDbService<T> {
    private db: Low<T>;

    constructor(private readonly initialData: T) {
        const file = join('db.json');
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
