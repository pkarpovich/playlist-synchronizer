import { mkdir, access, constants } from 'fs/promises';
import { join } from 'node:path';
import { JSONFilePreset } from 'lowdb/node';
import { type Low } from 'lowdb';

export class LocalDbService<T> {
    constructor(private readonly db: Low<T>) {}

    static async create<T>(
        initialData: T,
        dbFolderPath: string,
    ): Promise<Low<T>> {
        await LocalDbService.ensureFolderExists(dbFolderPath);
        const file = join(dbFolderPath, 'db.json');

        return await JSONFilePreset<T>(file, initialData);
    }

    async save(): Promise<void> {
        return this.db.write();
    }

    get(): T {
        return this.db.data;
    }

    async set(newValue: T): Promise<T | null> {
        this.db.data = newValue;
        await this.save();

        return this.db.data;
    }

    private static async ensureFolderExists(folderPath: string): Promise<void> {
        try {
            await access(folderPath, constants.F_OK);
        } catch {
            await mkdir(folderPath, { recursive: true });
        }
    }
}
