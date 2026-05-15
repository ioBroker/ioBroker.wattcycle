export interface BatteryEntry {
    mac: string;
    name: string;
    enabled?: boolean;
    /** Whether this battery participates in aggregated calculations (total/avg/min/max). Defaults to true. */
    includeInTotals?: boolean;
}

export interface WattCycleAdapterConfig {
    /** HCI device selector. Either a controller MAC (BD_ADDR, e.g. "AA:BB:CC:DD:EE:FF") — stable across reboots — or a numeric hciX index for legacy configs. */
    hciDevice: number | string;
    pollInterval: number | string;
    perBatteryGapMs: number | string;
    scanDurationMs: number | string;
    /** Comma-separated list of name prefixes to filter scan results. Empty = no filter. */
    namePrefixes: string;
    batteries: BatteryEntry[];
}
