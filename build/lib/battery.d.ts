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
    scan(timeoutMs?: number): Promise<ScanResult[]>;
    private findPeripheral;
    readBattery(mac: string): Promise<BatteryReadResult>;
    stop(): Promise<void>;
}
export {};
