import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import { cleanup } from './cleanup.js';

const handledSignals = ['SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2'] as const;

afterEach(() => {
    for (const signal of handledSignals) {
        process.removeAllListeners(signal);
    }
});

for (const signal of handledSignals) {
    test(`${signal} runs beforeExit and then exits`, () => {
        const calls: string[] = [];
        cleanup(
            () => calls.push('beforeExit'),
            () => calls.push('exit'),
        );

        process.emit(signal, signal);

        assert.deepEqual(calls, ['beforeExit', 'exit']);
    });
}
