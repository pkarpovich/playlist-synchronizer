import { Cron } from 'croner';

export type JobOptions = {
    pattern: string;
    cb: () => void;
    startNow?: boolean;
};

export class CronService {
    private jobs: Cron[] = [];

    constructor() {}

    addJob(options: JobOptions): Cron {
        const job = new Cron(options.pattern, options.cb);
        this.jobs.push(job);

        if (options.startNow) {
            this.triggerJob(job);
        }

        return job;
    }

    private stopJob(job: Cron): void {
        job.stop();
    }

    private triggerJob(job: Cron): void {
        job.fn();
    }

    stopAllJobs(): void {
        this.jobs.forEach((job) => this.stopJob(job));
    }

    triggerAllJobs(): void {
        this.jobs.forEach((job) => this.triggerJob(job));
    }
}
