// Reads BD_ADDR and Local Name from each HCI controller via raw HCI commands.
// sysfs (/sys/class/bluetooth/hciX/{address,device/product}) is unreliable on
// recent Pi kernels — the attributes are simply absent — so we go through the
// HCI socket that @stoprocent/bluetooth-hci-socket already exposes (it ships
// with @stoprocent/noble, which the adapter depends on).

const HCI_COMMAND_PKT = 0x01;
const HCI_ACLDATA_PKT = 0x02;
const HCI_EVENT_PKT = 0x04;
const EVT_CMD_COMPLETE = 0x0e;

const READ_BD_ADDR_OGF = 0x04;
const READ_BD_ADDR_OCF = 0x0009;
const READ_LOCAL_NAME_OGF = 0x03;
const READ_LOCAL_NAME_OCF = 0x0014;

export interface HciInfo {
    devId: number;
    address: string;
    name: string;
}

interface HciSocketLike {
    on(event: 'data', cb: (data: Buffer) => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    bindRaw(devId: number): number;
    setFilter(filter: Buffer): void;
    start(): void;
    stop(): void;
    write(data: Buffer): void;
    getDeviceList(): { devId: number }[];
}

interface HciSocketCtor {
    new (): HciSocketLike;
}

function loadHciSocket(): HciSocketCtor | null {
    try {
        const mod = require('@stoprocent/bluetooth-hci-socket') as {
            loadDriver?: (kind: string) => HciSocketCtor;
        };
        if (typeof mod.loadDriver !== 'function') {
            return null;
        }
        return mod.loadDriver('native');
    } catch {
        return null;
    }
}

function makeCmd(ogf: number, ocf: number): Buffer {
    const op = (ogf << 10) | ocf;
    const buf = Buffer.alloc(4);
    buf.writeUInt8(HCI_COMMAND_PKT, 0);
    buf.writeUInt16LE(op, 1);
    buf.writeUInt8(0x00, 3);
    return buf;
}

function makeFilter(): Buffer {
    // Allow command/event/ACL packets through, and keep Command Complete events.
    const filter = Buffer.alloc(14);
    const typeMask = (1 << HCI_COMMAND_PKT) | (1 << HCI_EVENT_PKT) | (1 << HCI_ACLDATA_PKT);
    filter.writeUInt32LE(typeMask, 0);
    filter.writeUInt32LE(1 << EVT_CMD_COMPLETE, 4);
    filter.writeUInt32LE(0, 8);
    filter.writeUInt16LE(0, 12);
    return filter;
}

function fmtMac(buf: Buffer, off: number): string {
    const out: string[] = [];
    for (let i = 5; i >= 0; i--) {
        out.push(buf[off + i].toString(16).padStart(2, '0'));
    }
    return out.join(':').toUpperCase();
}

// Some controllers (e.g. TP-Link UB500) don't NUL-terminate the local name and
// pad the 248-byte field with garbage — strip non-printable trailing bytes.
function sanitizeName(raw: Buffer): string {
    const nul = raw.indexOf(0);
    const slice = nul >= 0 ? raw.slice(0, nul) : raw;
    const text = slice.toString('utf8');
    let end = text.length;
    while (end > 0) {
        const code = text.charCodeAt(end - 1);
        if (code >= 0x20 && code !== 0x7f && code !== 0xfffd) {
            break;
        }
        end--;
    }
    return text.slice(0, end).trim();
}

function probe(Ctor: HciSocketCtor, devId: number, timeoutMs: number): Promise<HciInfo | null> {
    return new Promise(resolve => {
        const s = new Ctor();
        let address: string | null = null;
        let name: string | null = null;
        let done = false;
        let timer: NodeJS.Timeout | null = null;

        const finish = (result: HciInfo | null): void => {
            if (done) {
                return;
            }
            done = true;
            if (timer) {
                clearTimeout(timer);
            }
            try {
                s.stop();
            } catch {
                // ignore
            }
            resolve(result);
        };
        timer = setTimeout(() => {
            finish(address ? { devId, address, name: name ?? '' } : null);
        }, timeoutMs);

        s.on('error', () => finish(null));
        s.on('data', (data: Buffer) => {
            if (data[0] !== HCI_EVENT_PKT || data[1] !== EVT_CMD_COMPLETE) {
                return;
            }
            const opcode = data.readUInt16LE(4);
            const ogf = opcode >> 10;
            const ocf = opcode & 0x3ff;
            if (data[6] !== 0) {
                return;
            }
            if (ogf === READ_BD_ADDR_OGF && ocf === READ_BD_ADDR_OCF) {
                address = fmtMac(data, 7);
            } else if (ogf === READ_LOCAL_NAME_OGF && ocf === READ_LOCAL_NAME_OCF) {
                name = sanitizeName(data.slice(7, 7 + 248));
            }
            if (address !== null && name !== null) {
                finish({ devId, address, name });
            }
        });

        try {
            s.bindRaw(devId);
            s.setFilter(makeFilter());
            s.start();
            s.write(makeCmd(READ_BD_ADDR_OGF, READ_BD_ADDR_OCF));
            s.write(makeCmd(READ_LOCAL_NAME_OGF, READ_LOCAL_NAME_OCF));
        } catch {
            finish(null);
        }
    });
}

export async function readHciInfos(timeoutMs = 1500): Promise<HciInfo[]> {
    const Ctor = loadHciSocket();
    if (!Ctor) {
        return [];
    }
    let ids: number[];
    try {
        const lister = new Ctor();
        ids = lister.getDeviceList().map(d => d.devId);
    } catch {
        return [];
    }
    ids.sort((a, b) => a - b);
    const out: HciInfo[] = [];
    for (const devId of ids) {
        const info = await probe(Ctor, devId, timeoutMs);
        if (info) {
            out.push(info);
        }
    }
    return out;
}
