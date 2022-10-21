import { URL } from 'node:url';

export function parseUrlToQueryParams(url: string): Record<string, string> {
    return Object.fromEntries(new URL(url).searchParams);
}
