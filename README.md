![Logo](admin/wattcycle.png)
# ioBroker.wattcycle

Reads WattCycle / XDZN BLE batteries (TDT protocol, characteristics fff1/fff2/fffa, "HiLink" auth) into ioBroker.

## Features

- Continuously polls a configurable list of batteries via BLE.
- Per-battery states for SoC, voltage, current, power, capacity, cycles, MOSFET/PCB/cell temperatures, individual cell voltages.
- Built-in BLE scan from the admin UI to discover MAC addresses of nearby devices.
- Configurable poll interval, gap between batteries and Bluetooth (HCI) adapter.

## Configuration

Open the admin UI and on the **Main settings** tab choose:
- **Bluetooth adapter (hciX)** — the HCI device id (`0` = `hci0`).
- **Polling interval (ms)** — interval between full poll cycles.
- **Gap between batteries (ms)** — pause between consecutive battery reads in one cycle.
- **Scan duration (ms)** — how long the BLE scan runs.

On the **Batteries** tab press **Scan for BLE devices**, then copy MAC addresses of your batteries into the table below and assign each one a name.

## States

For every configured battery the following states are created under `wattcycle.<instance>.batteries.<name>`:

| State                  | Type    | Unit | Description                              |
|------------------------|---------|------|------------------------------------------|
| `soc`                  | number  | %    | State of charge                          |
| `voltage`              | number  | V    | Pack voltage                             |
| `current`              | number  | A    | Current (signed, charge positive)        |
| `power`                | number  | W    | Voltage × current                        |
| `remaining_ah`         | number  | Ah   | Remaining capacity                       |
| `total_ah`             | number  | Ah   | Total capacity                           |
| `design_ah`            | number  | Ah   | Design capacity                          |
| `cycles`               | number  |      | Cycle count                              |
| `cell_spread_mv`       | number  | mV   | Difference between highest/lowest cell   |
| `mos_temp`             | number  | °C   | MOSFET temperature                       |
| `pcb_temp`             | number  | °C   | PCB temperature                          |
| `cells_v`              | string  |      | JSON array of cell voltages (V)          |
| `cell_temps`           | string  |      | JSON array of cell temperatures (°C)     |
| `product.model_or_fw`  | string  |      | Model / firmware string                  |
| `product.manufacturer` | string  |      | Manufacturer string                      |
| `product.serial`       | string  |      | Serial number                            |
| `lastUpdate`           | number  |      | Timestamp of last successful read        |
| `reachable`            | boolean |      | True if last read succeeded              |
| `lastError`            | string  |      | Error from last failed read              |

## Messages

```js
// Force an immediate poll cycle
sendTo('wattcycle.0', 'pollNow', null, res => console.log(res));

// Run a BLE scan
sendTo('wattcycle.0', 'scan', { duration: 8000 }, res => console.log(res.devices));
```

## Requirements

- Linux with BlueZ (`apt install bluez libbluetooth-dev`).
- Node.js ≥ 20.
- Adapter must be allowed to access the HCI socket (typically run as root or with `setcap`).

## License

MIT
