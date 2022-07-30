interface EmptyFunction {
    (): Promise<any>;
}

function wait(duration: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

export async function retry(
    cb: EmptyFunction,
    beforeRetryCb: EmptyFunction,
    retries: number = 3,
    delay: number = 500,
): Promise<any> {
    let result: any;

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
