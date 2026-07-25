import timers from 'node:timers/promises';

export type DelayFn = (ms: number) => Promise<void>;

export const delay: DelayFn = async (ms) => {
    await timers.setTimeout(ms);
};
