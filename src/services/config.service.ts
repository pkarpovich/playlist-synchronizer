// @ts-ignore
const resolvePath = (object, path) =>
    // @ts-ignore
    path.split('.').reduce((o, p) => o[p], object);

export class ConfigService<T> {
    constructor(private readonly config: T) {}

    get(path: string): any {
        return resolvePath(this.config, path);
    }
}
