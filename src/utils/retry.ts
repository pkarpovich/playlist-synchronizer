interface EmptyFunction {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (): Promise<any>;
}

function wait(duration: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

export async function retry<T>(
    cb: EmptyFunction,
    beforeRetryCb: EmptyFunction,
    retries = 3,
    delay = 500,
): Promise<T> {
    let result: T;

    try {
        result = await cb();
    } catch (e) {
        await beforeRetryCb();
        if (retries > 1) {
            await wait(delay);
            result = await retry(cb, beforeRetryCb, retries - 1, delay * 2);
        } else {
            throw e;
        }
    }

    return result;
}
