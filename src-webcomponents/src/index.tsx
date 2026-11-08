/**
 * A WattCycle battery as a web component: `<iob-wattcycle-battery>`.
 *
 * One module for every host - vis-2, devices, Aura, admin (`@iobroker/web-components`). Its manifest is a file of
 * its own (`wattcycle-battery.json`, written by the build from `manifest.ts`), so a host loads this module only when
 * it shows the element. The host sets `socket` and `settings`, and if it has them `theme`, `editMode` and `dialogs`.
 *
 * The element shows what the vis-2 widget and the tile of the devices app show, with the same views
 * (`src-shared/BatteryView.tsx`): it reads the states of one battery device `wattcycle.<n>.batteries.<name>` or of
 * the sum `wattcycle.<n>.total`, and writes nothing. A click on the smaller views opens everything - health, cells,
 * temperatures - in a dialog the host frames.
 *
 * React is not in the module: it comes from `lib/esm/react-19.js` beside `adapter/`, see `vite.config.ts`.
 */
import { createRoot, type Root } from 'react-dom/client';

import { DIALOG_CLOSE_EVENT } from '@iobroker/web-components';
import { defineWebComponent, getThemeCssVariables, IobWebComponent } from '@iobroker/web-components/element';

import {
    applyStateValue,
    emptyBatteryValues,
    getStateIds,
    isTotalDevice,
    type BatteryField,
    type BatteryValues,
    type Translate,
} from '../../src-shared/batteryData';
import { BatteryFullView } from '../../src-shared/BatteryView';
import { BatteryWidget, Hint } from './BatteryWidget';
import { getBatteryDevice, LAYOUTS, TAG, type BatterySettings, type Layout } from './constants';
import { getHint, getTranslate } from './i18n';
import { DIALOG_STYLES, STYLES } from './styles';

/** Its `isFloatComma` is the decimal separator of the system */
const SYSTEM_CONFIG = 'system.config';

/** What the element and its dialog draw */
interface Battery {
    values: BatteryValues;
    t: Translate;
    name: string;
    isFloatComma: boolean;
}

/** The open dialog with the full view */
interface Details {
    content: HTMLElement;
    root: Root;
}

class WattCycleBatteryElement extends IobWebComponent<BatterySettings> {
    readonly #mount: HTMLDivElement;

    #root: Root | null = null;

    #details: Details | null = null;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLES;
        this.#mount = document.createElement('div');
        this.#mount.className = 'mount';
        shadow.append(style, this.#mount);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        // a host that only moves the element connects it again in the same task: keep React and the dialog then
        queueMicrotask(() => {
            if (!this.isConnected) {
                this.#closeDetails();
                this.#root?.unmount();
                this.#root = null;
            }
        });
    }

    protected override getStateIds(settings: BatterySettings): (string | undefined)[] {
        const device = getBatteryDevice(settings.device);
        return device ? Object.values(getStateIds(device)) : [];
    }

    protected override getObjectIds(settings: BatterySettings): string[] {
        const device = getBatteryDevice(settings.device);
        // the device for its name, the system for its decimal separator
        return device ? [device, SYSTEM_CONFIG] : [];
    }

    /** The battery as the views show it, from the subscribed states */
    #getBattery(device: string): Battery {
        const t = getTranslate(this.systemLang);
        let values = emptyBatteryValues();
        for (const [field, id] of Object.entries(getStateIds(device))) {
            const state = id ? this.states[id] : null;
            if (state) {
                values = applyStateValue(values, field as BatteryField, state.val);
            }
        }
        let name = this.settings.name || '';
        if (!name) {
            // the object name of `total` is a description, not a name
            name = isTotalDevice(device) ? t('Batteries') : this.text(this.objects[device]?.common?.name);
        }
        const config = this.objects[SYSTEM_CONFIG] as ioBroker.SystemConfigObject | null | undefined;
        return { values, t, name, isFloatComma: !!config?.common?.isFloatComma };
    }

    protected override render(): void {
        this.#root ||= createRoot(this.#mount);
        const settings = this.settings;
        const device = getBatteryDevice(settings.device);
        if (!device) {
            this.#closeDetails();
            this.#root.render(
                <Hint text={getHint(this.systemLang, settings.device ? 'notBattery' : 'chooseBattery')} />,
            );
            return;
        }

        const battery = this.#getBattery(device);
        const layout = LAYOUTS.includes(settings.layout as Layout) ? (settings.layout as Layout) : 'auto';
        const clickable = !this.editMode && settings.openDialog !== false;
        this.#root.render(
            <BatteryWidget
                layout={layout}
                {...battery}
                onDetails={clickable ? () => void this.#openDetails(device) : undefined}
            />,
        );
        if (this.#details) {
            this.#drawDetails(this.#details, battery);
        }
    }

    #drawDetails(details: Details, battery: Battery): void {
        // the dialog lies outside of the element: it gets the theme of the host as CSS variables too
        for (const [name, value] of Object.entries(getThemeCssVariables(this.theme))) {
            details.content.style.setProperty(name, value);
        }
        details.root.render(<BatteryFullView {...battery} />);
    }

    /** Everything in a dialog of the host, kept up to date while it is open */
    async #openDetails(device: string): Promise<void> {
        if (this.#details || this.editMode) {
            return;
        }
        const content = document.createElement('div');
        const shadow = content.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = DIALOG_STYLES;
        const mount = document.createElement('div');
        mount.className = 'details';
        shadow.append(style, mount);

        const details: Details = { content, root: createRoot(mount) };
        const battery = this.#getBattery(device);
        this.#details = details;
        this.#drawDetails(details, battery);
        try {
            await this.openDialog({ title: battery.name || battery.t('Battery'), element: content, width: 900 });
        } finally {
            if (this.#details === details) {
                this.#details = null;
            }
            details.root.unmount();
        }
    }

    /** Closes the dialog: the host and the dialog of the browser both close on this event */
    #closeDetails(): void {
        this.#details?.content.dispatchEvent(
            new CustomEvent(DIALOG_CLOSE_EVENT, { detail: null, bubbles: true, composed: true }),
        );
    }
}

defineWebComponent(TAG, WattCycleBatteryElement);
