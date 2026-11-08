/**
 * What `<iob-wattcycle-battery>` draws: one of the shared views of `src-shared/BatteryView.tsx` - the same as in the
 * vis-2 widget and the tile of the devices app - or, for the automatic layout, all of them, of which the container
 * queries of `styles.ts` show the one that fits the box.
 */
import type { JSX, KeyboardEvent } from 'react';

import type { BatteryValues, Translate } from '../../src-shared/batteryData';
import { BatteryBarView, BatteryCompactView, BatteryFullView, BatteryWideView } from '../../src-shared/BatteryView';
import type { Layout } from './constants';

type View = Exclude<Layout, 'auto'>;

/** The views of the automatic layout, in the order of `styles.ts` */
const AUTO_VIEWS: View[] = ['compact', 'wide', 'bar', 'full'];

/** A battery, the icon of the hints */
const BATTERY_ICON =
    'M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4';

export interface BatteryWidgetProps {
    layout: Layout;
    values: BatteryValues;
    t: Translate;
    isFloatComma?: boolean;
    name: string;
    /** Opens the full view in a dialog; missing in edit mode and when the settings switch it off */
    onDetails?: () => void;
}

/**
 * One view of the battery
 *
 * @param props the battery, and which view
 */
export function BatteryViewOf(props: Omit<BatteryWidgetProps, 'layout' | 'onDetails'> & { view: View }): JSX.Element {
    const { view, ...viewProps } = props;
    switch (view) {
        case 'full':
            return <BatteryFullView {...viewProps} />;
        case 'bar':
            return <BatteryBarView {...viewProps} />;
        case 'wide':
            return <BatteryWideView {...viewProps} />;
        default:
            return <BatteryCompactView {...viewProps} />;
    }
}

export function BatteryWidget(props: BatteryWidgetProps): JSX.Element {
    const { layout, onDetails, ...viewProps } = props;
    const views = layout === 'auto' ? AUTO_VIEWS : [layout];

    return (
        <div className={layout === 'auto' ? 'battery auto' : 'battery'}>
            {views.map(view => {
                // the full view shows everything already
                const onClick = view !== 'full' ? onDetails : undefined;
                return (
                    <div
                        key={view}
                        className={`view ${view}${onClick ? ' clickable' : ''}`}
                        role={onClick ? 'button' : undefined}
                        tabIndex={onClick ? 0 : undefined}
                        onClick={onClick}
                        onKeyDown={
                            onClick
                                ? (e: KeyboardEvent) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          onClick();
                                      }
                                  }
                                : undefined
                        }
                    >
                        <BatteryViewOf
                            view={view}
                            {...viewProps}
                        />
                    </div>
                );
            })}
        </div>
    );
}

/** A hint instead of the battery: none chosen, or the ID is not one */
export function Hint({ text }: { text: string }): JSX.Element {
    return (
        <div className="hint">
            <svg viewBox="0 0 24 24">
                <path d={BATTERY_ICON} />
            </svg>
            <span>{text}</span>
        </div>
    );
}
