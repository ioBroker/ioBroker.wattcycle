/**
 * vis-2 widget of a WattCycle battery.
 *
 * Picks its layout from its size unless one is chosen: a battery bar for flat widgets, the SOC arc with
 * the four values for wide ones, the arc alone for small square ones and everything - health, cells,
 * temperatures - once there is room for it. A click on the smaller layouts opens the full view in a
 * dialog. The views are the shared ones in `../src-shared`, the same as in the devices tile.
 */
import React from 'react';
import { Card, Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';

import type { RxRenderWidgetProps, RxWidgetInfo, VisRxWidgetProps, VisRxWidgetState } from '@iobroker/types-vis-2';
import type VisRxWidget from '@iobroker/types-vis-2/visRxWidget';

import {
    DEFAULT_DEVICE,
    applyStateValue,
    emptyBatteryValues,
    getStateIds,
    isTotalDevice,
    type BatteryField,
    type BatteryValues,
    type Translate,
} from '../../src-shared/batteryData';
import { BatteryBarView, BatteryCompactView, BatteryFullView, BatteryWideView } from '../../src-shared/BatteryView';
import { I18N_PREFIX } from '../../src-shared/translations';

type Layout = 'auto' | 'compact' | 'bar' | 'wide' | 'full';

interface WattCycleBatteryRxData {
    device: string;
    name: string;
    layout: Layout;
    card: boolean;
    openDialog: boolean;
}

interface WattCycleBatteryState extends VisRxWidgetState {
    battery: BatteryValues;
    deviceName: string;
    /** Measured size of the widget, for the automatic layout. `width`/`height` belong to vis-2 */
    boxWidth: number;
    boxHeight: number;
    dialogOpen: boolean;
}

/** The part of the socket connection this widget uses */
interface BatterySocket {
    subscribeState(id: string | string[], cb: (id: string, state: ioBroker.State | null | undefined) => void): unknown;
    unsubscribeState(id: string | string[], cb: (id: string, state: ioBroker.State | null | undefined) => void): void;
    getObject(id: string): Promise<ioBroker.Object | null | undefined>;
}

const CLOSE_ICON =
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

export default class WattCycleBattery extends (window.visRxWidget as typeof VisRxWidget)<
    WattCycleBatteryRxData,
    WattCycleBatteryState
> {
    private readonly rootRef = React.createRef<HTMLDivElement>();
    private resizeObserver: ResizeObserver | null = null;
    /** state ID -> value of the view */
    private subscribed: Record<string, BatteryField> = {};
    private subscribedDevice = '';

    private readonly translate: Translate = word => WattCycleBattery.t(word);

    constructor(props: VisRxWidgetProps) {
        super(props);
        this.state = {
            ...this.state,
            battery: emptyBatteryValues(),
            deviceName: '',
            boxWidth: 0,
            boxHeight: 0,
            dialogOpen: false,
        };
    }

    static getWidgetInfo(): RxWidgetInfo {
        return {
            id: 'tplWattCycleBattery',
            visSet: 'wattcycle',
            // vis-2 always puts the prefix in front of the set/widget labels and the help, so no prefix here
            visSetLabel: 'set_label',
            visSetColor: '#4fc3a1',
            visSetIcon: 'widgets/wattcycle/img/wattcycle.png',
            visName: 'WattCycleBattery',
            visWidgetLabel: 'widget_label',
            visHelp: 'widget_help',
            visAttrs: [
                {
                    name: 'common',
                    label: 'wattcycle_Common',
                    fields: [
                        {
                            name: 'device',
                            type: 'id',
                            label: 'wattcycle_Device',
                            tooltip: 'wattcycle_Device help',
                            filter: { type: 'device' },
                            default: DEFAULT_DEVICE,
                            noSubscribe: true,
                        },
                        {
                            name: 'name',
                            type: 'text',
                            label: 'wattcycle_Name',
                            tooltip: 'wattcycle_Name help',
                        },
                        {
                            name: 'layout',
                            type: 'select',
                            label: 'wattcycle_Layout',
                            options: [
                                { value: 'auto', label: 'wattcycle_layout_auto' },
                                { value: 'compact', label: 'wattcycle_layout_compact' },
                                { value: 'bar', label: 'wattcycle_layout_bar' },
                                { value: 'wide', label: 'wattcycle_layout_wide' },
                                { value: 'full', label: 'wattcycle_layout_full' },
                            ],
                            default: 'auto',
                        },
                        {
                            name: 'card',
                            type: 'checkbox',
                            label: 'wattcycle_Card',
                            default: true,
                        },
                        {
                            name: 'openDialog',
                            type: 'checkbox',
                            label: 'wattcycle_Open dialog',
                            default: true,
                        },
                    ],
                },
            ],
            visDefaultStyle: {
                width: 360,
                height: 180,
            },
            visPrev: 'widgets/wattcycle/img/prev_wattcycle.svg',
        };
    }

    getWidgetInfo(): RxWidgetInfo {
        return WattCycleBattery.getWidgetInfo();
    }

    static getI18nPrefix(): string {
        return I18N_PREFIX;
    }

    private get socket(): BatterySocket {
        return this.props.context.socket as unknown as BatterySocket;
    }

    private getDevice(): string {
        return this.state.rxData.device && this.state.rxData.device !== 'nothing_selected'
            ? this.state.rxData.device
            : DEFAULT_DEVICE;
    }

    componentDidMount(): void {
        super.componentDidMount();
        this.subscribe();
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(entries => {
                const rect = entries[0]?.contentRect;
                if (rect) {
                    const width = Math.round(rect.width);
                    const height = Math.round(rect.height);
                    if (width !== this.state.boxWidth || height !== this.state.boxHeight) {
                        this.setState({ boxWidth: width, boxHeight: height });
                    }
                }
            });
            this.observe();
        }
    }

    componentDidUpdate(prevProps: VisRxWidgetProps, prevState: typeof this.state): void {
        super.componentDidUpdate(prevProps, prevState);
        this.observe();
    }

    componentWillUnmount(): void {
        super.componentWillUnmount();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.unsubscribe();
    }

    onRxDataChanged(): void {
        if (this.getDevice() !== this.subscribedDevice) {
            this.unsubscribe();
            this.setState({ battery: emptyBatteryValues(), deviceName: '' });
            this.subscribe();
        }
    }

    /** The root element is rendered anew when the layout changes, so it is observed after every update */
    private observedElement: HTMLDivElement | null = null;

    private observe(): void {
        const el = this.rootRef.current;
        if (this.resizeObserver && el && el !== this.observedElement) {
            if (this.observedElement) {
                this.resizeObserver.unobserve(this.observedElement);
            }
            this.observedElement = el;
            this.resizeObserver.observe(el);
        }
    }

    private onBatteryState = (id: string, state: ioBroker.State | null | undefined): void => {
        const field = this.subscribed[id];
        if (field) {
            this.setState(prev => ({ battery: applyStateValue(prev.battery, field, state?.val) }));
        }
    };

    private subscribe(): void {
        const device = this.getDevice();
        this.subscribedDevice = device;
        this.subscribed = {};
        for (const [field, id] of Object.entries(getStateIds(device))) {
            if (id) {
                this.subscribed[id] = field as BatteryField;
            }
        }
        const ids = Object.keys(this.subscribed);
        if (ids.length) {
            void this.socket.subscribeState(ids, this.onBatteryState);
        }
        this.socket
            .getObject(device)
            .then(obj => {
                if (this.subscribedDevice !== device) {
                    return;
                }
                const name = obj?.common?.name;
                this.setState({ deviceName: name ? WattCycleBattery.getText(name) : '' });
            })
            .catch(() => {
                // no name then
            });
    }

    private unsubscribe(): void {
        const ids = Object.keys(this.subscribed);
        if (ids.length) {
            this.socket.unsubscribeState(ids, this.onBatteryState);
        }
        this.subscribed = {};
        this.subscribedDevice = '';
    }

    private getName(): string {
        if (this.state.rxData.name) {
            return this.state.rxData.name;
        }
        // The object name of `total` is a description, not a name
        return isTotalDevice(this.getDevice()) ? this.translate('Batteries') : this.state.deviceName;
    }

    private getLayout(): Exclude<Layout, 'auto'> {
        const layout = this.state.rxData.layout || 'auto';
        if (layout !== 'auto') {
            return layout;
        }
        const width = this.state.boxWidth;
        const height = this.state.boxHeight;
        if (!width || !height) {
            return 'compact';
        }
        if (width >= 560 && height >= 420) {
            return 'full';
        }
        if (height <= 110 && width >= height * 2.5) {
            return 'bar';
        }
        if (width >= height * 1.5) {
            return 'wide';
        }
        return 'compact';
    }

    private onClick = (): void => {
        if (!this.props.editMode && this.state.rxData.openDialog !== false && this.getLayout() !== 'full') {
            this.setState({ dialogOpen: true });
        }
    };

    private renderView(layout: Exclude<Layout, 'auto'>): React.JSX.Element {
        const props = {
            values: this.state.battery,
            t: this.translate,
            isFloatComma: this.props.context.systemConfig?.common?.isFloatComma,
            name: this.getName(),
        };
        switch (layout) {
            case 'full':
                return <BatteryFullView {...props} />;
            case 'bar':
                return <BatteryBarView {...props} />;
            case 'wide':
                return <BatteryWideView {...props} />;
            default:
                return <BatteryCompactView {...props} />;
        }
    }

    private renderDialog(): React.JSX.Element | null {
        if (!this.state.dialogOpen) {
            return null;
        }
        const close = (): void => this.setState({ dialogOpen: false });
        return (
            <Dialog
                open
                onClose={close}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle sx={{ pr: 6 }}>{this.getName() || this.translate('Battery')}</DialogTitle>
                <IconButton
                    onClick={close}
                    sx={{ position: 'absolute', top: 8, right: 8 }}
                >
                    <svg
                        viewBox="0 0 24 24"
                        style={{ width: 24, height: 24 }}
                    >
                        <path
                            fill="currentColor"
                            d={CLOSE_ICON}
                        />
                    </svg>
                </IconButton>
                <DialogContent>{this.renderView('full')}</DialogContent>
            </Dialog>
        );
    }

    renderWidgetBody(props: RxRenderWidgetProps): React.JSX.Element {
        super.renderWidgetBody(props);
        const layout = this.getLayout();
        const style: React.CSSProperties = {
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            padding: layout === 'bar' ? '0 12px' : 12,
            overflow: layout === 'full' ? 'auto' : 'hidden',
            cursor:
                !this.props.editMode && this.state.rxData.openDialog !== false && layout !== 'full'
                    ? 'pointer'
                    : undefined,
            display: 'flex',
            alignItems: layout === 'full' ? 'flex-start' : 'center',
        };
        const content = this.renderView(layout);

        return (
            <>
                {this.state.rxData.card !== false ? (
                    <Card
                        ref={this.rootRef}
                        style={style}
                        onClick={this.onClick}
                    >
                        {content}
                    </Card>
                ) : (
                    <div
                        ref={this.rootRef}
                        style={style}
                        onClick={this.onClick}
                    >
                        {content}
                    </div>
                )}
                {this.renderDialog()}
            </>
        );
    }
}
