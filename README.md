# homebridge-pulse8-appletv-cec

A Homebridge dynamic platform plugin that uses a **Pulse-Eight USB-CEC Adapter** (`cec-client` / `libcec`) to capture Apple TV Siri Remote HDMI-CEC button presses (**Volume Up**, **Volume Down**, **Mute**) and expose them as native HomeKit `StatelessProgrammableSwitch` buttons.

This lets Homebridge users whose amplifiers, AV processors, soundbars, or projectors do **not** implement HDMI-CEC trigger any HomeKit accessory or automation directly from their Apple TV remote.

---

## Features

- **Native HomeKit Programmable Switches:** Exposes **Volume Up**, **Volume Down**, and **Mute** as `StatelessProgrammableSwitch` buttons in Apple Home—compatible with every other Homebridge plugin via standard HomeKit automations.
- **Tap & Hold Ramping Support:**
  - **Default (`longPress`):** Short tap emits `Single Press`; holding past `400ms` emits `Long Press` once.
  - **Optional (`repeat`):** Short tap emits `Single Press`; holding past `400ms` continuously emits `Single Press` every `150ms` until release (with a `5s` safety timeout if a CEC release packet is missed).
- **Dynamic Apple TV Discovery (`scan`):** Runs `cec-client` `scan` automatically on startup rather than hardcoding Logical Address `4`. If multiple Apple TVs are present on the HDMI bus, each discovered Apple TV gets its own HomeKit accessory (unless filtered in `config.json`).
- **System Audio Mode Persistence:** Emulates a CEC Audio System (`-t a`, Logical Address `5`) and replies to tvOS status/power polls (`tx 5F:72:01`, `tx 5<src>:7a:32`, `tx 5<src>:90:00`) so the Siri Remote stays locked in HDMI-CEC volume mode across wakes.
- **Clean Shutdown & Auto-Respawn:** Gracefully terminates `cec-client` on Homebridge `shutdown` so the USB serial port is never left locked, and automatically respawns if the USB connection resets.

---

## Prerequisites

### 1. Install `libcec` (`cec-client`)

- **macOS (Homebrew):**
  ```bash
  brew install libcec
  ```
- **Linux / Raspberry Pi (Debian/Ubuntu):**
  ```bash
  sudo apt-get update && sudo apt-get install -y cec-utils
  ```

Verify your Pulse-Eight adapter is detected:
```bash
cec-client -l
```

### 2. Apple TV Settings

On each Apple TV you want to capture:
1. **Settings → Remotes and Devices → Control TVs and Receivers:** `On`
2. **Settings → Remotes and Devices → Volume Control:** `Auto` or `Receiver via HDMI`

---

## HomeKit Automation Setup

1. Restart Homebridge after configuring the plugin.
2. Open the **Apple Home** app and locate your Apple TV CEC accessory (e.g. **Apple TV**).
3. You will see three programmable buttons:
   - **Volume Up** (`Single Press`, `Long Press`)
   - **Volume Down** (`Single Press`, `Long Press`)
   - **Mute** (`Single Press`)
4. Assign a HomeKit Scene or Shortcut/Automation (for example, stepping your amplifier's volume accessory up/down or toggling mute) to each button press.

---

## Configuration

| Option | Default | Description |
| :--- | :--- | :--- |
| `cecClientPath` | `cec-client` | Path to the `cec-client` binary (e.g. `/opt/homebrew/bin/cec-client`). |
| `portPath` | *(auto-detect)* | Optional explicit serial port (e.g. `/dev/cu.usbmodemv121` on macOS or `/dev/ttyACM0` on Linux). |
| `osdName` | `Homebridge` | CEC OSD name advertised by the adapter (up to 14 characters). |
| `hdmiPort` | *(unset)* | Optional HDMI port number (`1`–`15`) passed as `-p`. |
| `holdMode` | `longPress` | `longPress` (Single Press `<400ms` / Long Press `>=400ms`) or `repeat` (repeated Single Press every `150ms`). |
| `holdDelayMs` | `400` | Threshold in milliseconds before hold behavior activates. |
| `holdRepeatMs` | `150` | Repeat interval in milliseconds when `holdMode` is `repeat`. |
| `holdSafetyMs` | `5000` | Safety timeout in milliseconds in case a CEC release (`0x45`) frame is dropped. |
| `rescanIntervalSec` | `0` | Optional periodic bus rescan interval in seconds (`0` = startup & unknown traffic only). |
| `devices` | `[]` | Optional filter/override list to rename, select, or disable specific discovered Apple TVs. |

---

## Development & Testing

```bash
npm install
npm test
```
