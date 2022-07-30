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
            job.fn();
        }

        return job;
    }

    stopJob(job: Cron): void {
        job.stop();
    }

    stopAllJobs(): void {
        this.jobs.forEach((job) => this.stopJob(job));
    }
}
