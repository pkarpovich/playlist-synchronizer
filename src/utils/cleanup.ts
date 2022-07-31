type CleanupOptions = {
    cleanup?: boolean;
    exit?: boolean;
};

export function cleanup(beforeExit: () => void, cleanCb?: () => void): void {
    process.stdin.resume(); //so the program will not close instantly

    function exitHandler(options: CleanupOptions) {
        if (options.cleanup) {
            cleanCb?.();
        }

        if (options.exit) {
            beforeExit();
            process.exit();
        }
    }

    //do something when app is closing
    process.on('exit', exitHandler.bind(null, { cleanup: true }));

    //catches ctrl+c event
    process.on('SIGINT', exitHandler.bind(null, { exit: true }));

    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
    process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));

    //catches uncaught exceptions
    process.on('uncaughtException', (err) => {
        console.error('UncaughtException: ', err);
        exitHandler.bind(null, { exit: true });
    });
}
