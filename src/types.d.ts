export interface BatteryEntry {
    mac: string;
    name: string;
    enabled?: boolean;
}

export interface WattCycleAdapterConfig {
    hciDevice: number | string;
    pollInterval: number | string;
    perBatteryGapMs: number | string;
    scanDurationMs: number | string;
    /** Comma-separated list of name prefixes to filter scan results. Empty = no filter. */
    namePrefixes: string;
    batteries: BatteryEntry[];
}
