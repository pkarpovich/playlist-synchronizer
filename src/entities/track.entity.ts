export type Track = {
    id?: string;

    name: string;

    version?: string;

    artists: string[];

    durationMs?: number;

    unavailable?: boolean;

    source?: unknown;
};
