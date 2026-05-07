// WattCycle / XDZN BLE battery reader (TDT protocol).
// JS-Port von wattcycle.py mit @stoprocent/noble.

const FRAME_HEAD_TX = 0x1e;
const FRAME_HEAD_RX = 0x7e;
const FRAME_TAIL = 0x0d;

const DP_ANALOG = 0x008c;
const DP_PRODUCT = 0x0092;

const UUID_NOTIFY = 'fff1';
const UUID_WRITE = 'fff2';
const UUID_AUTH = 'fffa';

const AUTH_KEY = Buffer.from('HiLink', 'utf8');

const SCAN_TIMEOUT_MS = 15000;
const FRAME_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 15000;
const DISCOVER_SERVICES_TIMEOUT_MS = 10000;
const SUBSCRIBE_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 5000;
const DISCONNECT_TIMEOUT_MS = 5000;
const STOP_SCAN_TIMEOUT_MS = 3000;
// Upper bound for an entire readBattery call. Belt-and-suspenders watchdog —
// even if a noble call hangs forever, the polling loop will move on.
const READ_BATTERY_BUDGET_MS = 60000;

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(msg)), ms);
        p.then(
            v => {
                clearTimeout(t);
                resolve(v);
            },
            e => {
                clearTimeout(t);
                reject(e instanceof Error ? e : new Error(String(e)));
            },
        );
    });
}

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

function modbusCrc16(buf: Buffer): number {
    let crc = 0xffff;
    for (const b of buf) {
        crc ^= b;
        for (let i = 0; i < 8; i++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
        }
    }
    return crc;
}

function buildReadFrame(dp: number): Buffer {
    const body = Buffer.from([FRAME_HEAD_TX, 0x00, 0x01, 0x03, (dp >> 8) & 0xff, dp & 0xff, 0x00, 0x00]);
    const crc = modbusCrc16(body);
    return Buffer.concat([body, Buffer.from([(crc >> 8) & 0xff, crc & 0xff, FRAME_TAIL])]);
}

function parseCurrentSigned(data: Buffer, off: number): [number, number] {
    const b0 = data[off];
    const b1 = data[off + 1];
    const neg = (b0 & 0x80) !== 0;
    const dec = (b0 & 0x40) !== 0;
    const raw = b1 | ((b0 & 0x3f) << 8);
    let val = dec ? raw / 10.0 : raw;
    if (neg) {
        val = -val;
    }
    return [val, off + 2];
}

function parseAnalog(payload: Buffer): BatteryAnalog {
    let o = 0;
    const nCells = payload[o++];
    const cells: number[] = [];
    for (let i = 0; i < nCells; i++) {
        cells.push(payload.readUInt16BE(o) / 1000.0);
        o += 2;
    }
    const nTemps = payload[o++];
    const mos = (payload.readUInt16BE(o) - 2730) / 10.0;
    o += 2;
    const pcb = (payload.readUInt16BE(o) - 2730) / 10.0;
    o += 2;
    const cellTemps: number[] = [];
    for (let i = 0; i < nTemps - 2; i++) {
        cellTemps.push((payload.readUInt16BE(o) - 2730) / 10.0);
        o += 2;
    }
    const result = parseCurrentSigned(payload, o);
    const current = result[0];
    o = result[1];
    const voltage = payload.readUInt16BE(o) / 100.0;
    o += 2;
    const remCap = payload.readUInt16BE(o) / 10.0;
    o += 2;
    const totCap = payload.readUInt16BE(o) / 10.0;
    o += 2;
    const cycles = payload.readUInt16BE(o);
    o += 2;
    const desCap = payload.readUInt16BE(o) / 10.0;
    o += 2;
    const soc = payload.readUInt16BE(o);
    o += 2;

    const r = (n: number, d: number): number => Number(n.toFixed(d));
    return {
        soc,
        voltage: r(voltage, 2),
        current: r(current, 1),
        power: r(voltage * current, 1),
        remaining_ah: r(remCap, 1),
        total_ah: r(totCap, 1),
        design_ah: r(desCap, 1),
        cycles,
        cells_v: cells.map(v => r(v, 3)),
        cell_spread_mv: Math.round((Math.max(...cells) - Math.min(...cells)) * 1000),
        mos_temp: r(mos, 1),
        pcb_temp: r(pcb, 1),
        cell_temps: cellTemps.map(t => r(t, 1)),
    };
}

function parseProduct(payload: Buffer): BatteryProduct {
    if (payload.length !== 60) {
        return {
            model_or_fw: payload.toString('hex'),
            manufacturer: '',
            serial: `unexpected length ${payload.length}`,
        };
    }
    // eslint-disable-next-line no-control-regex
    const trim = (b: Buffer): string => b.toString('ascii').replace(/[\x00 ]+$/g, '');
    return {
        model_or_fw: trim(payload.subarray(0, 20)),
        manufacturer: trim(payload.subarray(20, 40)),
        serial: trim(payload.subarray(40, 60)),
    };
}

function uuidMatches(actual: string | undefined, short: string): boolean {
    if (!actual) {
        return false;
    }
    const a = actual.toLowerCase().replace(/-/g, '');
    const s = short.toLowerCase().replace(/-/g, '');
    return a === s || a === `0000${s}00001000800000805f9b34fb`;
}

function parseFrame(frame: Buffer): Buffer | null {
    if (frame.length < 11) {
        return null;
    }
    if (frame[0] !== FRAME_HEAD_RX) {
        return null;
    }
    if (frame[frame.length - 1] !== FRAME_TAIL) {
        return null;
    }
    const dataLen = frame.readUInt16BE(6);
    return frame.subarray(8, 8 + dataLen);
}

class FrameAssembler {
    private buf: Buffer = Buffer.alloc(0);
    private expected: number | null = null;
    private _resolve: ((frame: Buffer) => void) | null = null;

    public waitFor(): Promise<Buffer> {
        this.buf = Buffer.alloc(0);
        this.expected = null;
        this._resolve = null;
        return new Promise<Buffer>(resolve => {
            this._resolve = resolve;
        });
    }

    public feed(data: Buffer): void {
        this.buf = Buffer.concat([this.buf, data]);
        if (this.expected === null && this.buf.length >= 8) {
            this.expected = this.buf.readUInt16BE(6) + 11;
        }
        if (this.expected !== null && this.buf.length >= this.expected && this._resolve) {
            const frame = this.buf.subarray(0, this.expected);
            const r = this._resolve;
            this._resolve = null;
            r(frame);
        }
    }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export class WattCycleBle {
    private readonly noble: any;
    private readonly log: MinimalLogger;
    private busy = false;

    public constructor(noble: any, log: MinimalLogger) {
        this.noble = noble;
        this.log = log;
    }

    public async waitPoweredOn(timeoutMs = 10000): Promise<void> {
        const state = this.noble._state || this.noble.state;
        if (state === 'poweredOn') {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            let onState: ((s: string) => void) | null = null;
            const timer = setTimeout(() => {
                this.noble.removeListener('stateChange', onState);
                reject(new Error(`Bluetooth adapter not powered on (state=${this.noble._state || this.noble.state})`));
            }, timeoutMs);
            onState = (s: string): void => {
                if (s === 'poweredOn') {
                    clearTimeout(timer);
                    this.noble.removeListener('stateChange', onState);
                    resolve();
                }
            };
            this.noble.on('stateChange', onState);
        });
    }

    public isBusy(): boolean {
        return this.busy;
    }

    public getPowerState(): string {
        return this.noble._state || this.noble.state || 'unknown';
    }

    public isPoweredOn(): boolean {
        return this.getPowerState() === 'poweredOn';
    }

    public async scan(timeoutMs = 8000): Promise<ScanResult[]> {
        if (this.busy) {
            throw new Error('BLE adapter is busy');
        }
        this.busy = true;
        const found = new Map<string, ScanResult>();
        try {
            await this.waitPoweredOn();
            const onDiscover = (p: any): void => {
                const addr = (p.address || '').toLowerCase();
                if (!addr) {
                    return;
                }
                const localName: string = p.advertisement?.localName || '';
                const rssi: number = typeof p.rssi === 'number' ? p.rssi : 0;
                const prev = found.get(addr);
                if (!prev || (localName && !prev.localName)) {
                    found.set(addr, { address: addr, localName, rssi });
                }
            };
            this.noble.on('discover', onDiscover);
            try {
                await this.noble.startScanningAsync([], false);
                await sleep(timeoutMs);
            } finally {
                try {
                    await this.noble.stopScanningAsync();
                } catch {
                    // ignore
                }
                this.noble.removeListener('discover', onDiscover);
            }
            return Array.from(found.values()).sort((a, b) => b.rssi - a.rssi);
        } finally {
            this.busy = false;
        }
    }

    private async findPeripheral(targetMac: string): Promise<any> {
        const target = targetMac.toLowerCase();
        // Best-effort scan stop. Some noble/HCI states cause stopScanningAsync to
        // never resolve, so we never await it on the rejection path — that hang
        // would otherwise wedge the entire polling loop.
        const stopScanFireAndForget = (): void => {
            withTimeout(
                Promise.resolve(this.noble.stopScanningAsync()),
                STOP_SCAN_TIMEOUT_MS,
                'stopScanningAsync timeout',
            ).catch(() => {
                /* ignore */
            });
        };
        return new Promise((resolve, reject) => {
            let done = false;
            let onDiscover: ((p: any) => void) | null = null;
            let timer: NodeJS.Timeout | null = null;
            const cleanup = (): void => {
                if (onDiscover) {
                    this.noble.removeListener('discover', onDiscover);
                }
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
            };
            timer = setTimeout(() => {
                if (done) {
                    return;
                }
                done = true;
                cleanup();
                stopScanFireAndForget();
                reject(new Error(`Scan timeout: ${target} not found`));
            }, SCAN_TIMEOUT_MS);
            onDiscover = (p: any): void => {
                if (done) {
                    return;
                }
                if ((p.address || '').toLowerCase() !== target) {
                    return;
                }
                done = true;
                cleanup();
                stopScanFireAndForget();
                resolve(p);
            };
            this.noble.on('discover', onDiscover);
            this.noble.startScanningAsync([], false).catch((e: Error) => {
                if (done) {
                    return;
                }
                done = true;
                cleanup();
                reject(e);
            });
        });
    }

    public async readBattery(mac: string): Promise<BatteryReadResult> {
        if (this.busy) {
            throw new Error('BLE adapter is busy');
        }
        this.busy = true;
        try {
            return await withTimeout(
                this.readBatteryInner(mac),
                READ_BATTERY_BUDGET_MS,
                `readBattery budget exceeded for ${mac}`,
            );
        } finally {
            this.busy = false;
        }
    }

    private async readBatteryInner(mac: string): Promise<BatteryReadResult> {
        await this.waitPoweredOn();
        this.log.debug(`Searching for ${mac}...`);
        const peripheral = await this.findPeripheral(mac);
        this.log.debug(`Connecting to ${mac}...`);
        await withTimeout(Promise.resolve(peripheral.connectAsync()), CONNECT_TIMEOUT_MS, `Connect timeout for ${mac}`);
        try {
            const { characteristics } = await withTimeout(
                Promise.resolve(peripheral.discoverAllServicesAndCharacteristicsAsync()),
                DISCOVER_SERVICES_TIMEOUT_MS,
                `Service discovery timeout for ${mac}`,
            );
            const findChar = (short: string): any => characteristics.find((c: any) => uuidMatches(c.uuid, short));
            const writeChar = findChar(UUID_WRITE);
            const notifyChar = findChar(UUID_NOTIFY);
            const authChar = findChar(UUID_AUTH);
            if (!writeChar || !notifyChar || !authChar) {
                throw new Error('Required characteristics (fff1/fff2/fffa) missing');
            }

            const asm = new FrameAssembler();
            notifyChar.on('data', (data: Buffer) => asm.feed(data));
            await withTimeout(
                Promise.resolve(notifyChar.subscribeAsync()),
                SUBSCRIBE_TIMEOUT_MS,
                `Subscribe timeout for ${mac}`,
            );

            await withTimeout(
                Promise.resolve(authChar.writeAsync(AUTH_KEY, false)),
                WRITE_TIMEOUT_MS,
                `Auth write timeout for ${mac}`,
            );
            await sleep(300);

            const result: BatteryReadResult = {};
            for (const [name, dp] of [
                ['product', DP_PRODUCT],
                ['analog', DP_ANALOG],
            ] as [string, number][]) {
                const wait = asm.waitFor();
                const cmd = buildReadFrame(dp);
                await withTimeout(
                    Promise.resolve(writeChar.writeAsync(cmd, true)),
                    WRITE_TIMEOUT_MS,
                    `DP 0x${dp.toString(16)} write timeout for ${mac}`,
                );
                const frame = await Promise.race([wait, sleep(FRAME_TIMEOUT_MS).then(() => null)]);
                if (!frame) {
                    this.log.warn(`Timeout reading DP 0x${dp.toString(16)} from ${mac}`);
                    continue;
                }
                const payload = parseFrame(frame);
                if (!payload) {
                    this.log.warn(`Invalid frame from ${mac} for DP 0x${dp.toString(16)}`);
                    continue;
                }
                if (name === 'product') {
                    result.product = parseProduct(payload);
                } else {
                    result.analog = parseAnalog(payload);
                }
            }
            return result;
        } finally {
            try {
                await withTimeout(
                    Promise.resolve(peripheral.disconnectAsync()),
                    DISCONNECT_TIMEOUT_MS,
                    `Disconnect timeout for ${mac}`,
                );
            } catch {
                // ignore
            }
        }
    }

    public async stop(): Promise<void> {
        try {
            await this.noble.stopScanningAsync();
        } catch {
            // ignore
        }
    }
}
