import signale from 'signale';

export class LogService {
    private logger: typeof signale;

    constructor() {
        this.logger = signale;
        signale.config({
            displayTimestamp: true,
            displayDate: true,
        });
    }

    info(message: string): void {
        this.logger.info(message);
    }

    warn(message: string): void {
        this.logger.warn(message);
    }

    success(message: string): void {
        this.logger.success(message);
    }

    error(message: string | Error): void {
        this.logger.error(message);
    }

    await(message: string): void {
        this.logger.await(message);
    }
}
