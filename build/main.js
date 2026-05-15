"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const node_fs_1 = require("node:fs");
const battery_1 = require("./lib/battery");
const hci_info_1 = require("./lib/hci-info");
const MAC_RE = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
function readSysFile(path) {
    try {
        return (0, node_fs_1.readFileSync)(path, 'utf8').trim();
    }
    catch {
        return '';
    }
}
async function readHciAdapters() {
    // Primary: HCI ioctl (works regardless of sysfs attribute availability).
    try {
        const infos = await (0, hci_info_1.readHciInfos)();
        if (infos.length) {
            return infos.map(i => ({ id: i.devId, address: i.address.toUpperCase() })).sort((a, b) => a.id - b.id);
        }
    }
    catch {
        // fall through
    }
    // Fallback: sysfs. Older kernels and non-Linux platforms.
    const out = [];
    const sysPath = '/sys/class/bluetooth';
    try {
        if ((0, node_fs_1.existsSync)(sysPath)) {
            for (const name of (0, node_fs_1.readdirSync)(sysPath)) {
                const m = /^hci(\d+)$/.exec(name);
                if (!m) {
                    continue;
                }
                out.push({
                    id: parseInt(m[1], 10),
                    address: readSysFile(`${sysPath}/${name}/address`).toUpperCase(),
                });
            }
        }
    }
    catch {
        // ignore
    }
    out.sort((a, b) => a.id - b.id);
    return out;
}
// Resolve a configured value (MAC string or numeric index) to the current hciX id.
// Returns -1 if a MAC was given but no controller currently exposes it.
async function resolveHciId(value) {
    if (typeof value === 'string' && MAC_RE.test(value.trim())) {
        const wanted = value.trim().toUpperCase();
        const adapters = await readHciAdapters();
        const match = adapters.find(a => a.address === wanted);
        return match ? match.id : -1;
    }
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
async function listHciAdapters() {
    // Primary: query each controller via raw HCI commands (Read_BD_ADDR /
    // Read_Local_Name). Recent Pi kernels no longer expose those attributes in
    // sysfs, so this is the only reliable source for both name and MAC.
    const out = [];
    try {
        const infos = await (0, hci_info_1.readHciInfos)();
        for (const info of infos) {
            const parts = [];
            if (info.name) {
                parts.push(info.name);
            }
            if (info.address) {
                parts.push(info.address);
            }
            const hciName = `hci${info.devId}`;
            const label = parts.length ? `${hciName} — ${parts.join(' · ')}` : hciName;
            out.push({ value: info.address || info.devId, label });
        }
    }
    catch {
        // fall through to sysfs probe
    }
    if (out.length) {
        return out;
    }
    // Fallback: sysfs (older kernels, non-Linux dev environments).
    const sysPath = '/sys/class/bluetooth';
    try {
        if ((0, node_fs_1.existsSync)(sysPath)) {
            for (const name of (0, node_fs_1.readdirSync)(sysPath)) {
                const m = /^hci(\d+)$/.exec(name);
                if (!m) {
                    continue;
                }
                const id = parseInt(m[1], 10);
                const base = `${sysPath}/${name}`;
                const address = readSysFile(`${base}/address`).toUpperCase();
                const product = readSysFile(`${base}/device/product`);
                const manufacturer = readSysFile(`${base}/device/manufacturer`);
                const friendly = product || manufacturer;
                const parts = [];
                if (friendly) {
                    parts.push(friendly);
                }
                if (address) {
                    parts.push(address);
                }
                const label = parts.length ? `${name} — ${parts.join(' · ')}` : name;
                out.push({ value: address || id, label });
            }
        }
    }
    catch {
        // ignore
    }
    return out;
}
const ANALOG_STATES = [
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
const PRODUCT_STATES = [
    { id: 'product.model_or_fw', name: 'Model / Firmware', type: 'string', role: 'text', read: true, write: false },
    { id: 'product.manufacturer', name: 'Manufacturer', type: 'string', role: 'text', read: true, write: false },
    { id: 'product.serial', name: 'Serial number', type: 'string', role: 'text', read: true, write: false },
];
const STATUS_STATES = [
    { id: 'lastUpdate', name: 'Last successful read', type: 'number', role: 'date', read: true, write: false },
    { id: 'reachable', name: 'Reachable', type: 'boolean', role: 'indicator.reachable', read: true, write: false },
    { id: 'lastError', name: 'Last error', type: 'string', role: 'text', read: true, write: false },
];
const TOTAL_STATES = [
    {
        id: 'soc',
        name: 'Average state of charge',
        type: 'number',
        role: 'value.battery',
        unit: '%',
        read: true,
        write: false,
    },
    {
        id: 'soc_min',
        name: 'Lowest state of charge',
        type: 'number',
        role: 'value.battery',
        unit: '%',
        read: true,
        write: false,
    },
    {
        id: 'soc_max',
        name: 'Highest state of charge',
        type: 'number',
        role: 'value.battery',
        unit: '%',
        read: true,
        write: false,
    },
    {
        id: 'voltage',
        name: 'Average voltage',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        read: true,
        write: false,
    },
    {
        id: 'voltage_min',
        name: 'Lowest pack voltage',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        read: true,
        write: false,
    },
    {
        id: 'voltage_max',
        name: 'Highest pack voltage',
        type: 'number',
        role: 'value.voltage',
        unit: 'V',
        read: true,
        write: false,
    },
    {
        id: 'current',
        name: 'Total current',
        type: 'number',
        role: 'value.current',
        unit: 'A',
        read: true,
        write: false,
    },
    { id: 'power', name: 'Total power', type: 'number', role: 'value.power', unit: 'W', read: true, write: false },
    {
        id: 'remaining_ah',
        name: 'Total remaining capacity',
        type: 'number',
        role: 'value',
        unit: 'Ah',
        read: true,
        write: false,
    },
    { id: 'total_ah', name: 'Total capacity', type: 'number', role: 'value', unit: 'Ah', read: true, write: false },
    {
        id: 'design_ah',
        name: 'Total design capacity',
        type: 'number',
        role: 'value',
        unit: 'Ah',
        read: true,
        write: false,
    },
    { id: 'cycles_avg', name: 'Average cycle count', type: 'number', role: 'value', read: true, write: false },
    {
        id: 'cell_spread_mv_max',
        name: 'Max cell spread',
        type: 'number',
        role: 'value',
        unit: 'mV',
        read: true,
        write: false,
    },
    {
        id: 'mos_temp_max',
        name: 'Max MOSFET temperature',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        read: true,
        write: false,
    },
    {
        id: 'pcb_temp_max',
        name: 'Max PCB temperature',
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
        read: true,
        write: false,
    },
    { id: 'count', name: 'Number of reachable batteries', type: 'number', role: 'value', read: true, write: false },
    { id: 'lastUpdate', name: 'Last aggregate update', type: 'number', role: 'date', read: true, write: false },
];
function sanitizeId(s) {
    return (s || '').toString().replace(/[^a-zA-Z0-9_]/g, '_');
}
function macToId(mac) {
    return mac.toLowerCase().replace(/[^a-f0-9]/g, '');
}
function parsePrefixes(raw) {
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map(p => p.trim().toLowerCase())
        .filter(p => p.length > 0);
}
function matchesPrefix(name, prefixes) {
    if (!prefixes.length) {
        return true;
    }
    if (!name) {
        return false;
    }
    const lower = name.toLowerCase();
    return prefixes.some(p => lower.startsWith(p));
}
class WattcycleAdapter extends adapter_core_1.Adapter {
    ble = null;
    noble = null;
    currentHci = -1;
    pollTimer = null;
    polling = false;
    stopping = false;
    // Last good analog read per battery (key = lowercased mac). Used so that
    // aggregate totals can include batteries that were unreachable in the
    // current poll cycle — their previously known values are kept until they
    // are next read successfully.
    lastAnalog = new Map();
    constructor(options = {}) {
        super({
            ...options,
            name: 'wattcycle',
            unload: cb => this.onUnload(cb),
            message: obj => this.onAdapterMessage(obj),
            ready: () => this.onReady(),
        });
    }
    onUnload(cb) {
        this.stopping = true;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        const finish = () => {
            try {
                cb();
            }
            catch {
                // ignore
            }
        };
        if (this.ble) {
            void this.ble.stop().finally(finish);
        }
        else {
            finish();
        }
    }
    async onReady() {
        if (process.platform !== 'linux' && process.platform !== 'darwin') {
            this.log.error(`This adapter requires Linux (BlueZ) or macOS. Current platform: ${process.platform}. Stopping.`);
            await this.setStateAsync('info.connection', false, true);
            if (typeof this.terminate === 'function') {
                this.terminate('Unsupported platform', 11);
            }
            return;
        }
        const hci = await resolveHciId(this.config.hciDevice);
        if (hci < 0) {
            const adapters = await readHciAdapters();
            this.log.error(`Configured Bluetooth controller MAC ${String(this.config.hciDevice)} is not present. ` +
                `Available: ${adapters.map(a => `hci${a.id}=${a.address || '?'}`).join(', ') || 'none'}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }
        try {
            await this.setupBle(hci);
            await this.setStateAsync('info.connection', true, true);
        }
        catch (e) {
            this.log.error(`Bluetooth not ready: ${e.message}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }
        const batteries = Array.isArray(this.config.batteries) ? this.config.batteries : [];
        const enabled = batteries.filter(b => b && b.mac && b.enabled !== false);
        await this.syncBatteryObjects(enabled);
        await this.restoreAnalogCache(enabled);
        if (!enabled.length) {
            this.log.info('No batteries configured. Use the admin UI to scan and add batteries.');
            return;
        }
        const interval = parseInt(this.config.pollInterval, 10);
        const pollMs = Number.isFinite(interval) && interval >= 5000 ? interval : 60000;
        this.log.info(`Starting polling for ${enabled.length} battery/batteries every ${pollMs} ms`);
        this.schedulePoll(0);
    }
    async setupBle(hciId) {
        this.log.debug(`setupBle(hci${hciId}) start`);
        if (this.noble && this.currentHci === hciId) {
            this.log.debug('setupBle: already initialised, skip');
            return;
        }
        if (this.noble) {
            // The @stoprocent/noble HCI binding holds native socket state that
            // cannot be cleanly reset in-process. Switching to a different
            // controller requires a process restart so noble can re-initialise
            // against the new device.
            throw new Error(`Cannot switch to hci${hciId} in-process — please restart the adapter to apply the change.`);
        }
        process.env.NOBLE_HCI_DEVICE_ID = String(hciId);
        this.log.debug('setupBle: requiring @stoprocent/noble');
        const nobleModule = require('@stoprocent/noble');
        try {
            this.noble = nobleModule.withBindings('hci', { deviceId: hciId });
            this.log.debug('setupBle: created noble binding via withBindings("hci", { deviceId })');
        }
        catch (e) {
            this.log.debug(`setupBle: withBindings(deviceId) failed: ${e.message}`);
            this.noble = nobleModule.withBindings ? nobleModule.withBindings('hci') : nobleModule;
            this.log.debug('setupBle: fallback noble binding created');
        }
        this.currentHci = hciId;
        this.ble = new battery_1.WattCycleBle(this.noble, {
            info: m => this.log.info(m),
            warn: m => this.log.warn(m),
            error: m => this.log.error(m),
            debug: m => this.log.debug(m),
        });
        this.log.debug(`setupBle: waiting for poweredOn (current state="${this.ble.getPowerState()}")`);
        await this.ble.waitPoweredOn(15000);
        this.log.info(`Bluetooth adapter hci${hciId} powered on`);
    }
    schedulePoll(delay) {
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
    async pollAll() {
        if (this.stopping || this.polling || !this.ble) {
            return;
        }
        this.polling = true;
        const interval = parseInt(this.config.pollInterval, 10);
        const pollMs = Number.isFinite(interval) && interval >= 5000 ? interval : 60000;
        const gap = parseInt(this.config.perBatteryGapMs, 10);
        const gapMs = Number.isFinite(gap) && gap >= 0 ? gap : 1000;
        const start = Date.now();
        const batteries = (Array.isArray(this.config.batteries) ? this.config.batteries : []).filter(b => b && b.mac && b.enabled !== false);
        try {
            // Recover from a stuck/poweredOff HCI controller. The @stoprocent/noble
            // HCI binding holds native socket state that cannot be reset cleanly
            // in-process — re-requiring the module after a cache purge yields a
            // broken instance. The only reliable cure is a process restart, so
            // exit and let js-controller bring us back up with a fresh BLE stack.
            if (!this.ble.isPoweredOn()) {
                const state = this.ble.getPowerState();
                this.log.error(`Bluetooth controller hci${this.currentHci} is "${state}". ` +
                    `Terminating adapter so js-controller restarts it with a fresh BLE stack.`);
                this.stopping = true;
                if (this.pollTimer) {
                    clearTimeout(this.pollTimer);
                    this.pollTimer = null;
                }
                if (typeof this.terminate === 'function') {
                    this.terminate('BLE controller poweredOff', 156);
                }
                else {
                    process.exit(156);
                }
                return;
            }
            // Single up-front scan, then sequential connect/read for every
            // battery that was actually seen. This avoids one LE-scan per
            // battery — a single failed scan is enough to flip some HCI
            // controllers to poweredOff, so doing fewer scans means a far
            // more stable polling loop.
            const macs = batteries.map(b => b.mac);
            let resultMap;
            try {
                resultMap = await this.ble.readBatteries(macs);
            }
            catch (e) {
                this.log.error(`Polling round failed: ${e.message}`);
                return;
            }
            for (const bat of batteries) {
                if (this.stopping) {
                    break;
                }
                const devId = this.getDeviceId(bat);
                const prefix = `${devId}.`;
                const r = resultMap.get(bat.mac);
                if (r instanceof Error) {
                    const msg = r.message || String(r);
                    this.log.warn(`Poll ${bat.mac}: ${msg}`);
                    await this.setStateAsync(`${prefix}reachable`, false, true);
                    await this.setStateAsync(`${prefix}lastError`, msg, true);
                    continue;
                }
                if (!r) {
                    // Should not happen: readBatteries always returns one
                    // entry per requested mac. Treat as not reachable.
                    await this.setStateAsync(`${prefix}reachable`, false, true);
                    await this.setStateAsync(`${prefix}lastError`, 'No result returned', true);
                    continue;
                }
                if (r.analog) {
                    await this.writeAnalog(prefix, r.analog);
                    this.lastAnalog.set(bat.mac.toLowerCase(), r.analog);
                }
                if (r.product) {
                    await this.writeProduct(prefix, r.product);
                }
                await this.setStateAsync(`${prefix}lastUpdate`, Date.now(), true);
                await this.setStateAsync(`${prefix}reachable`, true, true);
                await this.setStateAsync(`${prefix}lastError`, '', true);
                this.log.debug(`Polled ${bat.mac}${r.analog ? ` SOC=${r.analog.soc}% V=${r.analog.voltage}V` : ''}`);
                if (gapMs > 0 && !this.stopping) {
                    await new Promise(resolve => setTimeout(resolve, gapMs));
                }
            }
            await this.writeTotal(batteries);
        }
        finally {
            this.polling = false;
            const elapsed = Date.now() - start;
            const next = Math.max(1000, pollMs - elapsed);
            this.schedulePoll(next);
        }
    }
    async writeAnalog(prefix, a) {
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
    async writeProduct(prefix, p) {
        await this.setStateAsync(`${prefix}product.model_or_fw`, p.model_or_fw, true);
        await this.setStateAsync(`${prefix}product.manufacturer`, p.manufacturer, true);
        await this.setStateAsync(`${prefix}product.serial`, p.serial, true);
    }
    async writeTotal(batteries) {
        const r = (n, d) => Number(n.toFixed(d));
        // Aggregate only over batteries flagged to participate in totals.
        // For each one, prefer the freshest reading; if it was unreachable
        // in this cycle, fall back to the last good reading we have cached.
        // Batteries that have never been read are simply skipped.
        const reads = [];
        for (const bat of batteries) {
            if (bat.includeInTotals === false) {
                continue;
            }
            const cached = this.lastAnalog.get(bat.mac.toLowerCase());
            if (cached) {
                reads.push(cached);
            }
        }
        const n = reads.length;
        await this.setStateAsync('total.count', n, true);
        await this.setStateAsync('total.lastUpdate', Date.now(), true);
        if (!n) {
            return;
        }
        const sum = (sel) => reads.reduce((s, a) => s + sel(a), 0);
        const avg = (sel) => sum(sel) / n;
        const max = (sel) => reads.reduce((m, a) => Math.max(m, sel(a)), -Infinity);
        const min = (sel) => reads.reduce((m, a) => Math.min(m, sel(a)), Infinity);
        await this.setStateAsync('total.soc', r(avg(a => a.soc), 1), true);
        await this.setStateAsync('total.soc_min', r(min(a => a.soc), 1), true);
        await this.setStateAsync('total.soc_max', r(max(a => a.soc), 1), true);
        await this.setStateAsync('total.voltage', r(avg(a => a.voltage), 2), true);
        await this.setStateAsync('total.voltage_min', r(min(a => a.voltage), 2), true);
        await this.setStateAsync('total.voltage_max', r(max(a => a.voltage), 2), true);
        await this.setStateAsync('total.current', r(sum(a => a.current), 1), true);
        await this.setStateAsync('total.power', r(sum(a => a.power), 1), true);
        await this.setStateAsync('total.remaining_ah', r(sum(a => a.remaining_ah), 1), true);
        await this.setStateAsync('total.total_ah', r(sum(a => a.total_ah), 1), true);
        await this.setStateAsync('total.design_ah', r(sum(a => a.design_ah), 1), true);
        await this.setStateAsync('total.cycles_avg', r(avg(a => a.cycles), 1), true);
        await this.setStateAsync('total.cell_spread_mv_max', Math.round(max(a => a.cell_spread_mv)), true);
        await this.setStateAsync('total.mos_temp_max', r(max(a => a.mos_temp), 1), true);
        await this.setStateAsync('total.pcb_temp_max', r(max(a => a.pcb_temp), 1), true);
    }
    getDeviceId(bat) {
        const named = bat.name ? sanitizeId(bat.name) : '';
        return `batteries.${named || `b_${macToId(bat.mac)}`}`;
    }
    // Repopulate the in-memory analog cache from previously persisted states
    // so that aggregate totals include known-but-currently-unreachable
    // batteries from the very first poll after an adapter restart.
    async restoreAnalogCache(batteries) {
        for (const bat of batteries) {
            const prefix = `${this.getDeviceId(bat)}.`;
            try {
                const readNum = async (id) => {
                    const s = await this.getStateAsync(`${prefix}${id}`);
                    const v = s?.val;
                    return typeof v === 'number' && Number.isFinite(v) ? v : null;
                };
                const readJson = async (id) => {
                    const s = await this.getStateAsync(`${prefix}${id}`);
                    if (typeof s?.val !== 'string' || !s.val) {
                        return [];
                    }
                    try {
                        const parsed = JSON.parse(s.val);
                        return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'number') : [];
                    }
                    catch {
                        return [];
                    }
                };
                const soc = await readNum('soc');
                const voltage = await readNum('voltage');
                if (soc === null || voltage === null) {
                    continue;
                }
                const analog = {
                    soc,
                    voltage,
                    current: (await readNum('current')) ?? 0,
                    power: (await readNum('power')) ?? 0,
                    remaining_ah: (await readNum('remaining_ah')) ?? 0,
                    total_ah: (await readNum('total_ah')) ?? 0,
                    design_ah: (await readNum('design_ah')) ?? 0,
                    cycles: (await readNum('cycles')) ?? 0,
                    cell_spread_mv: (await readNum('cell_spread_mv')) ?? 0,
                    mos_temp: (await readNum('mos_temp')) ?? 0,
                    pcb_temp: (await readNum('pcb_temp')) ?? 0,
                    cells_v: await readJson('cells_v'),
                    cell_temps: await readJson('cell_temps'),
                };
                this.lastAnalog.set(bat.mac.toLowerCase(), analog);
            }
            catch (e) {
                this.log.debug(`restoreAnalogCache ${bat.mac}: ${e.message}`);
            }
        }
        this.log.debug(`Restored analog cache for ${this.lastAnalog.size}/${batteries.length} battery/batteries`);
    }
    async syncBatteryObjects(batteries) {
        await this.setObjectNotExistsAsync('batteries', {
            type: 'channel',
            common: { name: 'Batteries' },
            native: {},
        });
        await this.setObjectNotExistsAsync('total', {
            type: 'device',
            common: { name: 'Aggregated total (sums and averages over all batteries)' },
            native: {},
        });
        for (const s of TOTAL_STATES) {
            const common = {
                name: s.name,
                type: s.type,
                role: s.role,
                read: true,
                write: false,
            };
            if (s.type === 'number' && s.unit) {
                common.unit = s.unit;
            }
            await this.setObjectNotExistsAsync(`total.${s.id}`, {
                type: 'state',
                common,
                native: {},
            });
        }
        const wantedDeviceIds = new Set();
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
                const common = {
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
        }
        catch (e) {
            this.log.debug(`syncBatteryObjects cleanup: ${e.message}`);
        }
    }
    async onAdapterMessage(obj) {
        if (!obj?.command) {
            return;
        }
        switch (obj.command) {
            case 'scan': {
                const msg = obj.message || {};
                const ms = parseInt(msg.duration, 10) ||
                    parseInt(this.config.scanDurationMs, 10) ||
                    8000;
                const targetHci = msg.hciDevice !== undefined && msg.hciDevice !== ''
                    ? await resolveHciId(msg.hciDevice)
                    : this.currentHci;
                if (targetHci < 0) {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: `Controller ${String(msg.hciDevice)} not present on this host` }, obj.callback);
                    }
                    return;
                }
                const prefixes = parsePrefixes(typeof msg.namePrefixes === 'string' ? msg.namePrefixes : this.config.namePrefixes);
                if (this.polling) {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: 'Adapter is currently polling, please retry in a moment' }, obj.callback);
                    }
                    return;
                }
                try {
                    if (targetHci !== this.currentHci) {
                        this.log.info(`Switching scan to hci${targetHci} (was hci${this.currentHci})`);
                        await this.setupBle(targetHci);
                    }
                    if (!this.ble) {
                        throw new Error('BLE not initialized');
                    }
                    this.log.info(`Scanning on hci${this.currentHci} for ${ms} ms${prefixes.length ? ` (filter: ${prefixes.join(', ')})` : ''}...`);
                    const raw = await this.ble.scan(ms);
                    const list = raw.filter(d => matchesPrefix(d.localName, prefixes));
                    this.log.info(`Scan finished: ${list.length} matching device(s)${prefixes.length ? ` (out of ${raw.length} total)` : ''}`);
                    if (obj.callback) {
                        // Combine the result with current settings
                        const batteries = this.config.batteries;
                        for (const item of list) {
                            this.log.debug(`  ${item.address} — ${item.localName || '<no name>'} (${item.rssi} dBm)`);
                            if (!batteries.find(it => it.mac === item.address)) {
                                batteries.push({
                                    name: item.localName,
                                    mac: item.address,
                                    enabled: true,
                                    includeInTotals: true,
                                });
                            }
                        }
                        this.sendTo(obj.from, obj.command, { native: { batteries } }, obj.callback);
                    }
                }
                catch (e) {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: e.message }, obj.callback);
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
                let adapters = await listHciAdapters();
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
    module.exports = (options) => new WattcycleAdapter(options);
}
else {
    (() => new WattcycleAdapter())();
}
//# sourceMappingURL=main.js.map