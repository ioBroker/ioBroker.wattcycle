/**
 * What the module, the manifest and the build of `<iob-wattcycle-battery>` share.
 *
 * Imported by `vite.config.ts` too, so it imports nothing but types.
 */
// with the extension: `vite.config.ts` imports this file, and Vite may load its config natively
import type { ViewWord } from '../../src-shared/batteryData.ts';

/** Tag of the custom element; a host checks that the module defines exactly this one */
export const TAG = 'iob-wattcycle-battery';

/** The built module, next to its manifest */
export const MODULE_FILE = 'wattcycle-battery.js';

/** The manifest the build writes next to the module; `common.webComponents` names this one */
export const MANIFEST_FILE = 'wattcycle-battery.json';

/** Where `tasks.js` puts the module in the admin folder; the React import is relative to it */
export const MODULE_PATH = `webcomponents/${MODULE_FILE}`;

/** How the battery is drawn: by the size of the box, or one of the views of `src-shared/BatteryView.tsx` */
export type Layout = 'auto' | 'compact' | 'bar' | 'wide' | 'full';

export const LAYOUTS: readonly Layout[] = ['auto', 'compact', 'bar', 'wide', 'full'];

/** The values of the settings of the manifest; a setting without a value is missing */
export type BatterySettings = {
    [name: string]: string | number | boolean | undefined;
    /** A battery device (`wattcycle.0.batteries.<name>`) or `wattcycle.0.total` */
    device?: string;
    /** Instead of the name of the device */
    name?: string;
    layout?: string;
    /** Open the full view in a dialog on a click; true if missing */
    openDialog?: boolean;
};

/**
 * The words of the shared views (`src-shared/i18n`), picked by the build. A `Record` over all of them, so a word
 * that is added to `ViewWord` and not here fails the type check instead of showing its key.
 */
const VIEW_WORD_SET: Record<ViewWord, true> = {
    SOC: true,
    Charging: true,
    Discharging: true,
    Idle: true,
    Offline: true,
    Battery: true,
    level_excellent: true,
    level_good: true,
    level_medium: true,
    level_low: true,
    level_critical: true,
    Voltage: true,
    Current: true,
    Power: true,
    Temperature: true,
    'Battery health': true,
    SOH: true,
    'Rated capacity': true,
    'Full capacity': true,
    Remaining: true,
    Cycles: true,
    Cells: true,
    'Cell spread': true,
    Temperatures: true,
    MOSFET: true,
    PCB: true,
    Model: true,
    Serial: true,
    'Last update': true,
    Batteries: true,
    Error: true,
};

export const VIEW_WORDS = Object.keys(VIEW_WORD_SET) as ViewWord[];

/**
 * The battery device for an ID of the setting: the device itself or one of its states
 *
 * @param id what the user picked, e.g. `wattcycle.0.batteries.Watt3` or `wattcycle.0.total.soc`
 * @returns `wattcycle.0.batteries.Watt3` or `wattcycle.0.total`, or null if the ID is no battery of the adapter
 */
export function getBatteryDevice(id: string | undefined): string | null {
    const match = id?.match(/^(wattcycle\.\d+\.(?:total|batteries\.[^.]+))(\.|$)/);
    return match ? match[1] : null;
}
