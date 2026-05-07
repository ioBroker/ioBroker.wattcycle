export interface BatteryAnalog {
    soc: number;
    voltage: number;
    current: number;
    power: number;
    remaining_ah: number;
    total_ah: number;
    design_ah: number;
    cycles: number;
    cells_v: number[];
    cell_spread_mv: number;
    mos_temp: number;
    pcb_temp: number;
    cell_temps: number[];
}
export interface BatteryProduct {
    model_or_fw: string;
    manufacturer: string;
    serial: string;
}
export interface BatteryReadResult {
    product?: BatteryProduct;
    analog?: BatteryAnalog;
}
export interface ScanResult {
    address: string;
    localName: string;
    rssi: number;
}
interface MinimalLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
}
export declare class WattCycleBle {
    private readonly noble;
    private readonly log;
    private busy;
    constructor(noble: any, log: MinimalLogger);
    waitPoweredOn(timeoutMs?: number): Promise<void>;
    isBusy(): boolean;
    getPowerState(): string;
    isPoweredOn(): boolean;
    scan(timeoutMs?: number): Promise<ScanResult[]>;
    /**
     * Single scan that collects all peripherals matching the given MACs.
     * Stops as soon as either every requested mac was seen, or the timeout
     * elapses. Returns a map keyed by lowercase mac. Macs not seen during
     * the scan window are simply absent from the map.
     */
    private findPeripherals;
    /**
     * Read every battery sequentially using a single up-front scan. This
     * minimises the number of LE-scans per polling round (1 instead of N),
     * which is critical on HCI stacks where an unsuccessful scan can knock
     * the controller into poweredOff. Offline batteries are simply absent
     * from the result map; the caller decides how to record that.
     */
    readBatteries(macs: string[]): Promise<Map<string, BatteryReadResult | Error>>;
    private readPeripheral;
    stop(): Promise<void>;
}
export {};
