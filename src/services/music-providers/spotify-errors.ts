export type TokenErrorClass = 'invalid-grant' | 'config-error' | 'transient';

export type ApiErrorAction =
    'refresh-retry' | 'no-retry' | 'retry-after' | 'backoff';

const DefaultRetryAfterMs = 1000;
const MaxRetryAfterMs = 60000;
const InvalidGrantCode = 'invalid_grant';
const WholeSecondsPattern = /^\d+$/;

export class SpotifyHttpError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string | null = null,
    ) {
        super(message);
        this.name = 'SpotifyHttpError';
    }
}

export class SpotifyNotAuthorizedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SpotifyNotAuthorizedError';
    }
}

export function readTokenErrorCode(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }

    const { error } = body as { error?: unknown };
    if (typeof error !== 'string') {
        return null;
    }

    return error;
}

export function classifyTokenResponse(
    status: number,
    body: unknown,
): TokenErrorClass {
    if (status === 429 || status >= 500) {
        return 'transient';
    }

    if (status === 400 && readTokenErrorCode(body) === InvalidGrantCode) {
        return 'invalid-grant';
    }

    return 'config-error';
}

export function classifyApiStatus(status: number): ApiErrorAction {
    if (status === 401) {
        return 'refresh-retry';
    }

    if (status === 429) {
        return 'retry-after';
    }

    if (status >= 500) {
        return 'backoff';
    }

    return 'no-retry';
}

export function parseRetryAfter(header: string | null): number {
    if (!header || !WholeSecondsPattern.test(header.trim())) {
        return DefaultRetryAfterMs;
    }

    return Math.min(Number(header.trim()) * 1000, MaxRetryAfterMs);
}
