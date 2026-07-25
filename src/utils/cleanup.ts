const exitSignals = ['SIGINT', 'SIGTERM', 'SIGUSR1', 'SIGUSR2'] as const;

export function cleanup(
    beforeExit: () => void,
    exitFn: () => void = () => process.exit(0),
): void {
    const handleExitSignal = () => {
        beforeExit();
        exitFn();
    };

    for (const signal of exitSignals) {
        process.on(signal, handleExitSignal);
    }
}
