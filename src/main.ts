import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { BatteryEntry, WattCycleAdapterConfig } from './types';
import { WattCycleBle, type BatteryAnalog, type BatteryProduct, type ScanResult } from './lib/battery';

interface HciAdapterInfo {
    value: number;
    label: string;
}

function listHciAdapters(): HciAdapterInfo[] {
    const out: HciAdapterInfo[] = [];
    const sysPath = '/sys/class/bluetooth';
    try {
        if (existsSync(sysPath)) {
            for (const name of readdirSync(sysPath)) {
                const m = /^hci(\d+)$/.exec(name);
                if (!m) {
                    continue;
                }
                const id = parseInt(m[1], 10);
                let address = '';
                try {
                    address = readFileSync(`${sysPath}/${name}/address`, 'utf8').trim();
                } catch {
                    // ignore
                }
                out.push({ value: id, label: address ? `${name} (${address})` : name });
            }
        }
    } catch {
        // ignore
    }
    out.sort((a, b) => a.value - b.value);
    return out;
}

interface NumberStateDef {
    id: string;
    name: string;
    type: 'number';
    role: string;
    unit?: string;
    read: true;
    write: false;
}

interface StringStateDef {
    id: string;
    name: string;
    type: 'string';
    role: string;
    read: true;
    write: false;
}

interface BoolStateDef {
    id: string;
    name: string;
    type: 'boolean';
    role: string;
    read: true;
    write: false;
}

type StateDef = NumberStateDef | StringStateDef | BoolStateDef;

const ANALOG_STATES: StateDef[] = [
    { id: 'soc', name: 'State of charge', type: 'number', role: 'value.battery', unit: '%', read: true, write: false },
    { id: 'voltage', name: 'Voltage', type: 'number', role: 'value.voltage', unit: 'V', read: true, write: false },
    { id: 'current', name: 'Current', type: 'number', role: 'value.current', unit: 'A', read: true, write: false },
    { id: 'power', name: 'Power', type: 'number', role: 'value.power', unit: 'W', read: true, write: false },
    {
        id: 'remaining_ah',
        name: 'Remaining capacity',
        type: 'number',
        role: 'value',
        unit: 'Ah',
        read: true,
        write: false,
    },
    { id: 'total_ah', name: 'Total capacity', type: 'number', role: 'value', unit: 'Ah', read: true, write: false },
    { id: 'design_ah', name: 'Design capacity', type: 'number', role: 'value', unit: 'Ah', read: true, write: false },
    { id: 'cycles', name: 'Cycle count', type: 'number', role: 'value', read: true, write: false },
    {
        id: 'cell_spread_mv',
        name: 'Cell spread',
        type: 'number',
        role: 'value',
        unit: 'mV',
        read: true,
        write: false,
    },
    {
        id: 'mos_temp',
        name: 'MOSFET temperature',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        read: true,
        write: false,
    },
    {
        id: 'pcb_temp',
        name: 'PCB temperature',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        read: true,
        write: false,
    },
    { id: 'cells_v', name: 'Cell voltages (JSON)', type: 'string', role: 'json', read: true, write: false },
    {
        id: 'cell_temps',
        name: 'Cell temperatures (JSON)',
        type: 'string',
        role: 'json',
        read: true,
        write: false,
    },
];

const PRODUCT_STATES: StateDef[] = [
    { id: 'product.model_or_fw', name: 'Model / Firmware', type: 'string', role: 'text', read: true, write: false },
    { id: 'product.manufacturer', name: 'Manufacturer', type: 'string', role: 'text', read: true, write: false },
    { id: 'product.serial', name: 'Serial number', type: 'string', role: 'text', read: true, write: false },
];

const STATUS_STATES: StateDef[] = [
    { id: 'lastUpdate', name: 'Last successful read', type: 'number', role: 'date', read: true, write: false },
    { id: 'reachable', name: 'Reachable', type: 'boolean', role: 'indicator.reachable', read: true, write: false },
    { id: 'lastError', name: 'Last error', type: 'string', role: 'text', read: true, write: false },
];

function sanitizeId(s: string): string {
    return (s || '').toString().replace(/[^a-zA-Z0-9_]/g, '_');
}

function macToId(mac: string): string {
    return mac.toLowerCase().replace(/[^a-f0-9]/g, '');
}

class WattcycleAdapter extends Adapter {
    declare public config: WattCycleAdapterConfig;

    private ble: WattCycleBle | null = null;
    private noble: any = null;
    private pollTimer: NodeJS.Timeout | null = null;
    private polling = false;
    private stopping = false;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'wattcycle',
            unload: cb => this.onUnload(cb),
            message: obj => this.onAdapterMessage(obj),
            ready: () => this.onReady(),
        });
    }

    private onUnload(cb: () => void): void {
        this.stopping = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        const finish = (): void => {
            try {
                cb();
            } catch {
                // ignore
            }
        };
        if (this.ble) {
            this.ble.stop().finally(finish);
        } else {
            finish();
        }
    }

    private async onReady(): Promise<void> {
        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            this.log.error(
                `This adapter requires Linux (BlueZ) or macOS. Current platform: ${process.platform}. Stopping.`,
            );
            await this.setStateAsync('info.connection', false, true);
            if (typeof this.terminate === 'function') {
                this.terminate('Unsupported platform', 11);
            }
            return;
        }

        const hciDevice = parseInt(this.config.hciDevice as string, 10);
        const hci = Number.isFinite(hciDevice) && hciDevice >= 0 ? hciDevice : 0;
        process.env.NOBLE_HCI_DEVICE_ID = String(hci);

        try {
            const nobleModule = require('@stoprocent/noble');
            this.noble = nobleModule.withBindings ? nobleModule.withBindings('hci') : nobleModule;
        } catch (e) {
            this.log.error(`Cannot load @stoprocent/noble: ${(e as Error).message}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        this.ble = new WattCycleBle(this.noble, {
            info: m => this.log.info(m),
            warn: m => this.log.warn(m),
            error: m => this.log.error(m),
            debug: m => this.log.debug(m),
        });

        try {
            await this.ble.waitPoweredOn(15000);
            this.log.info(`Bluetooth adapter hci${hci} powered on`);
            await this.setStateAsync('info.connection', true, true);
        } catch (e) {
            this.log.error(`Bluetooth not ready: ${(e as Error).message}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        const batteries = Array.isArray(this.config.batteries) ? this.config.batteries : [];
        const enabled = batteries.filter(b => b && b.mac && b.enabled !== false);

        await this.syncBatteryObjects(enabled);

        if (!enabled.length) {
            this.log.info('No batteries configured. Use the admin UI to scan and add batteries.');
            return;
        }

        const interval = parseInt(this.config.pollInterval as string, 10);
        const pollMs = Number.isFinite(interval) && interval >= 5000 ? interval : 60000;
        this.log.info(`Starting polling for ${enabled.length} battery/batteries every ${pollMs} ms`);
        this.schedulePoll(0);
    }

    private schedulePoll(delay: number): void {
        if (this.stopping) {
            return;
        }
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
        }
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            void this.pollAll();
        }, delay);
    }

    private async pollAll(): Promise<void> {
        if (this.stopping || this.polling || !this.ble) {
            return;
        }
        this.polling = true;
        const interval = parseInt(this.config.pollInterval as string, 10);
        const pollMs = Number.isFinite(interval) && interval >= 5000 ? interval : 60000;
        const gap = parseInt(this.config.perBatteryGapMs as string, 10);
        const gapMs = Number.isFinite(gap) && gap >= 0 ? gap : 1000;

        const start = Date.now();
        const batteries = (Array.isArray(this.config.batteries) ? this.config.batteries : []).filter(
            b => b && b.mac && b.enabled !== false,
        );
        try {
            for (const bat of batteries) {
                if (this.stopping) {
                    break;
                }
                await this.pollBattery(bat);
                if (gapMs > 0 && !this.stopping) {
                    await new Promise<void>(resolve => setTimeout(resolve, gapMs));
                }
            }
        } finally {
            this.polling = false;
            const elapsed = Date.now() - start;
            const next = Math.max(1000, pollMs - elapsed);
            this.schedulePoll(next);
        }
    }

    private async pollBattery(bat: BatteryEntry): Promise<void> {
        if (!this.ble) {
            return;
        }
        const devId = this.getDeviceId(bat);
        const prefix = `${devId}.`;
        try {
            const data = await this.ble.readBattery(bat.mac);
            if (data.analog) {
                await this.writeAnalog(prefix, data.analog);
            }
            if (data.product) {
                await this.writeProduct(prefix, data.product);
            }
            await this.setStateAsync(`${prefix}lastUpdate`, Date.now(), true);
            await this.setStateAsync(`${prefix}reachable`, true, true);
            await this.setStateAsync(`${prefix}lastError`, '', true);
            this.log.debug(
                `Polled ${bat.mac}${data.analog ? ` SOC=${data.analog.soc}% V=${data.analog.voltage}V` : ''}`,
            );
        } catch (e) {
            const msg = (e as Error).message || String(e);
            this.log.warn(`Poll ${bat.mac}: ${msg}`);
            await this.setStateAsync(`${prefix}reachable`, false, true);
            await this.setStateAsync(`${prefix}lastError`, msg, true);
        }
    }

    private async writeAnalog(prefix: string, a: BatteryAnalog): Promise<void> {
        await this.setStateAsync(`${prefix}soc`, a.soc, true);
        await this.setStateAsync(`${prefix}voltage`, a.voltage, true);
        await this.setStateAsync(`${prefix}current`, a.current, true);
        await this.setStateAsync(`${prefix}power`, a.power, true);
        await this.setStateAsync(`${prefix}remaining_ah`, a.remaining_ah, true);
        await this.setStateAsync(`${prefix}total_ah`, a.total_ah, true);
        await this.setStateAsync(`${prefix}design_ah`, a.design_ah, true);
        await this.setStateAsync(`${prefix}cycles`, a.cycles, true);
        await this.setStateAsync(`${prefix}cell_spread_mv`, a.cell_spread_mv, true);
        await this.setStateAsync(`${prefix}mos_temp`, a.mos_temp, true);
        await this.setStateAsync(`${prefix}pcb_temp`, a.pcb_temp, true);
        await this.setStateAsync(`${prefix}cells_v`, JSON.stringify(a.cells_v), true);
        await this.setStateAsync(`${prefix}cell_temps`, JSON.stringify(a.cell_temps), true);
    }

    private async writeProduct(prefix: string, p: BatteryProduct): Promise<void> {
        await this.setStateAsync(`${prefix}product.model_or_fw`, p.model_or_fw, true);
        await this.setStateAsync(`${prefix}product.manufacturer`, p.manufacturer, true);
        await this.setStateAsync(`${prefix}product.serial`, p.serial, true);
    }

    private getDeviceId(bat: BatteryEntry): string {
        const named = bat.name ? sanitizeId(bat.name) : '';
        return `batteries.${named || `b_${macToId(bat.mac)}`}`;
    }

    private async syncBatteryObjects(batteries: BatteryEntry[]): Promise<void> {
        await this.setObjectNotExistsAsync('batteries', {
            type: 'channel',
            common: { name: 'Batteries' },
            native: {},
        });

        const wantedDeviceIds = new Set<string>();

        for (const bat of batteries) {
            const devId = this.getDeviceId(bat);
            wantedDeviceIds.add(devId);

            await this.setObjectAsync(devId, {
                type: 'device',
                common: { name: bat.name || bat.mac },
                native: { mac: bat.mac },
            });
            await this.setObjectNotExistsAsync(`${devId}.product`, {
                type: 'channel',
                common: { name: 'Product info' },
                native: {},
            });
            for (const s of [...ANALOG_STATES, ...PRODUCT_STATES, ...STATUS_STATES]) {
                const common: ioBroker.StateCommon = {
                    name: s.name,
                    type: s.type,
                    role: s.role,
                    read: true,
                    write: false,
                };
                if (s.type === 'number' && s.unit) {
                    common.unit = s.unit;
                }
                await this.setObjectNotExistsAsync(`${devId}.${s.id}`, {
                    type: 'state',
                    common,
                    native: { mac: bat.mac },
                });
            }
        }

        // delete devices that are no longer configured
        try {
            const existing = await this.getDevicesAsync();
            for (const dev of existing) {
                const idParts = dev._id.split('.');
                if (idParts.length < 4 || idParts[2] !== 'batteries') {
                    continue;
                }
                const relId = idParts.slice(2).join('.');
                if (!wantedDeviceIds.has(relId)) {
                    this.log.info(`Removing battery device no longer configured: ${dev._id}`);
                    await this.delObjectAsync(dev._id, { recursive: true });
                }
            }
        } catch (e) {
            this.log.debug(`syncBatteryObjects cleanup: ${(e as Error).message}`);
        }
    }

    private async onAdapterMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj?.command) {
            return;
        }
        switch (obj.command) {
            case 'scan': {
                if (!this.ble) {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: 'BLE not initialized' }, obj.callback);
                    }
                    return;
                }
                const ms =
                    parseInt((obj.message as { duration?: number })?.duration as unknown as string, 10) ||
                    parseInt(this.config.scanDurationMs as string, 10) ||
                    8000;
                if (this.polling) {
                    if (obj.callback) {
                        this.sendTo(
                            obj.from,
                            obj.command,
                            { error: 'Adapter is currently polling, please retry in a moment' },
                            obj.callback,
                        );
                    }
                    return;
                }
                try {
                    this.log.info(`Scanning for BLE devices for ${ms} ms...`);
                    const list: ScanResult[] = await this.ble.scan(ms);
                    this.log.info(`Scan finished: ${list.length} device(s) found`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { devices: list }, obj.callback);
                    }
                } catch (e) {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: (e as Error).message }, obj.callback);
                    }
                }
                break;
            }

            case 'pollNow': {
                if (this.polling) {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { ok: false, busy: true }, obj.callback);
                    }
                    return;
                }
                this.schedulePoll(0);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                }
                break;
            }

            case 'listHciAdapters': {
                let adapters = listHciAdapters();
                if (!adapters.length) {
                    adapters = [
                        { value: 0, label: 'hci0' },
                        { value: 1, label: 'hci1' },
                    ];
                }
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, adapters, obj.callback);
                }
                break;
            }
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<AdapterOptions> | undefined) => new WattcycleAdapter(options);
} else {
    (() => new WattcycleAdapter())();
}
