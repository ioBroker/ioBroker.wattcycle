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
    batteries: BatteryEntry[];
}
