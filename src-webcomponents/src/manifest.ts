/**
 * The manifest of `<iob-wattcycle-battery>`.
 *
 * Run by the build only (`vite.config.ts`), which writes it as `wattcycle-battery.json` next to the module - a host
 * reads that file for its palette and its settings without loading the module. The words come from the files of
 * the adapter, so they are the same as in the native widgets:
 *
 * - `name` and `description` are those of the tile of the devices app (`common.deviceWidgets` in io-package.json).
 *   devices and vis-2 hide a web component whose adapter brings a native widget of the same name, so devices
 *   shows its own tile and Aura the web component.
 * - The labels of the settings are those of the vis-2 widget (`src-shared/i18n`).
 */
import type { WebComponentManifest, WebComponentText } from '@iobroker/web-components';

// with the extension: `vite.config.ts` imports this file, and Vite may load its config natively
import { LAYOUTS, MODULE_FILE, TAG } from './constants.ts';

export { MANIFEST_FILE, MODULE_PATH, TAG } from './constants.ts';

/** The words of `src-shared/i18n` the manifest uses, without the prefix `wattcycle_` */
export const MANIFEST_WORDS = [
    'Device',
    'Device help',
    'Name',
    'Name help',
    'Layout',
    'Open dialog',
    ...LAYOUTS.map(layout => `layout_${layout}`),
];

/** What the manifest takes over from the tile of the devices app */
export interface NativeWidget {
    label: WebComponentText;
    description?: WebComponentText;
}

/**
 * The manifest with the words of the adapter
 *
 * @param word a word of `MANIFEST_WORDS` in all languages
 * @param native the tile of the devices app
 */
export function buildManifest(word: (key: string) => WebComponentText, native: NativeWidget): WebComponentManifest {
    return {
        $schema: 'https://raw.githubusercontent.com/ioBroker/web-components/main/schemas/manifest.json',
        manifestVersion: 1,
        tag: TAG,
        name: native.label,
        description: native.description,
        // relative to this file: /adapter/wattcycle/wattcycle.png
        icon: '../wattcycle.png',
        module: MODULE_FILE,
        // the default size of the vis-2 widget, a 2x1 tile of the devices app
        size: { width: 360, height: 180 },
        settings: {
            type: 'panel',
            items: {
                device: {
                    type: 'objectId',
                    types: 'device',
                    // every instance of the adapter; the element takes the instance from the ID
                    root: 'wattcycle',
                    label: word('Device'),
                    help: word('Device help'),
                    // like the native widgets: the sum of all batteries of the first instance
                    default: 'wattcycle.0.total',
                },
                name: {
                    type: 'text',
                    label: word('Name'),
                    help: word('Name help'),
                },
                layout: {
                    type: 'select',
                    label: word('Layout'),
                    options: LAYOUTS.map(layout => ({ value: layout, label: word(`layout_${layout}`) })),
                    default: 'auto',
                },
                openDialog: {
                    type: 'checkbox',
                    label: word('Open dialog'),
                    default: true,
                },
            },
        },
    };
}
