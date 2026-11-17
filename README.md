# homebridge-pulse8-appletv-cec

A Homebridge dynamic platform plugin that uses a **Pulse-Eight USB-CEC Adapter** (`cec-client` / `libcec`) to capture Apple TV Siri Remote HDMI-CEC button presses (**Volume Up**, **Volume Down**, **Mute**) and expose them as native HomeKit `StatelessProgrammableSwitch` buttons—with built-in **direct Trinnov TCP port `44100` volume/mute control** and automatic `homebridge-trinnov` discovery.

This lets Homebridge users whose amplifiers, AV processors, soundbars, or projectors do **not** implement HDMI-CEC either trigger any HomeKit automation or send low-latency `dvolume` / `mute` commands directly to a Trinnov processor from their Apple TV remote.

---

## Features

- **Direct Trinnov Control (TCP `44100`):** Sends `dvolume <step>` and `mute 2` commands directly to your Trinnov Altitude / Optimizer over TCP port `44100` with persistent warm connections, `id` handshake, clean `bye` idle disconnect, and zero-latency hold ramping.
- **Automatic `homebridge-trinnov` Discovery (Same Process & Child Bridges):** Discovers your Trinnov IP/port automatically via:
  1. Per-Apple TV or platform-level config overrides (`trinnovHost`, `trinnovId`, `trinnovPort`),
  2. Live discovery from `homebridge-trinnov` via `<storagePath>/homebridge-trinnov-discovery.json` and/or HTTP (`GET /api/cec/targets`),
  3. Automatic fallback inspection of Homebridge's `config.json` for any configured `homebridge-trinnov` plugin.
- **Native HomeKit Programmable Switches:** Exposes **Volume Up**, **Volume Down**, and **Mute** as `StatelessProgrammableSwitch` buttons in Apple Home—compatible with every other Homebridge plugin via standard HomeKit automations.
- **Tap & Hold Ramping Support:**
  - **HomeKit Switches (`longPress` default):** Short tap emits `Single Press`; holding past `400ms` emits `Long Press` once (or set `holdMode` to `repeat` for repeated `Single Press` ticks).
  - **Direct Trinnov TCP Control:** Always emits an immediate step on press and continuously repeats every `150ms` while held until release (`0x45`) or `5s` safety timeout.
- **Dynamic Apple TV Discovery (`scan`):** Runs `cec-client` `scan` automatically on startup rather than hardcoding Logical Address `4`. If multiple Apple TVs are present on the HDMI bus, each discovered Apple TV gets its own HomeKit accessory (unless filtered in `config.json`).
- **System Audio Mode Persistence:** Emulates a CEC Audio System (`-t a`, Logical Address `5`) and replies to tvOS status/power polls (`tx 5F:72:01`, `tx 5<src>:7a:32`, `tx 5<src>:90:00`) so the Siri Remote stays locked in HDMI-CEC volume mode across wakes.
- **Clean Shutdown & Auto-Respawn:** Gracefully terminates `cec-client` and closes Trinnov sockets (`bye`) on Homebridge `shutdown`.

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

## `homebridge-trinnov` Discovery & HTTP Contract

To let `homebridge-pulse8-appletv-cec` discover Trinnov processors dynamically across both **same-process** and **Homebridge Child Bridge** setups:

### 1. Shared Discovery File (Recommended for Same Host / Child Bridges)

`homebridge-trinnov` writes (atomically via temp file + rename) `<api.user.storagePath()>/homebridge-trinnov-discovery.json`:

```json
{
  "version": 1,
  "plugin": "homebridge-trinnov",
  "updatedAt": "2026-11-16T20:51:27.000Z",
  "pid": 12345,
  "http": {
    "baseUrl": "http://127.0.0.1:44180",
    "targetsPath": "/api/cec/targets"
  },
  "processors": [
    {
      "id": "theater-trinnov",
      "name": "Theater Altitude 32",
      "host": "192.168.1.50",
      "port": 44100,
      "powered": true,
      "activeSource": "Apple TV",
      "volumeStepDb": 0.5
    }
  ]
}
```

### 2. Optional HTTP Discovery Endpoint (Cross-Container / LAN)

If `homebridge-trinnov` binds a local HTTP server (e.g. `http://127.0.0.1:44180`), `GET /api/cec/targets` returns the exact same JSON schema (`200 OK`, `application/json`). Configure `trinnovDiscoveryUrl` in `homebridge-pulse8-appletv-cec` if `homebridge-trinnov` runs in a separate container/host without shared `storagePath`.

### Target Resolution Priority (Per Apple TV)

1. `devices[].trinnovEnabled === false` or `trinnovControl === "disabled"` → Do not send to Trinnov.
2. `devices[].trinnovHost` → Explicit host override for that Apple TV.
3. `devices[].trinnovId` → Match discovered processor by `id` or `name`.
4. `trinnovHost` → Global platform override.
5. Auto-discovered processors (`HTTP discovery` → `homebridge-trinnov-discovery.json` → Homebridge `config.json` fallback): matches `activeSource` against the Apple TV name if multiple processors exist, then `powered === true`, then first processor.

---

## HomeKit Automation Setup

1. Restart Homebridge after configuring the plugin.
2. Open the **Apple Home** app and locate your Apple TV CEC accessory (e.g. **Apple TV**).
3. You will see three programmable buttons:
   - **Volume Up** (`Single Press`, `Long Press`)
   - **Volume Down** (`Single Press`, `Long Press`)
   - **Mute** (`Single Press`)
4. Assign any HomeKit Scene or Automation if desired (or rely on automatic direct Trinnov TCP `44100` control).

---

## Configuration

| Option | Default | Description |
| :--- | :--- | :--- |
| `cecClientPath` | `cec-client` | Path to the `cec-client` binary (e.g. `/opt/homebrew/bin/cec-client`). |
| `portPath` | *(auto-detect)* | Optional explicit serial port (e.g. `/dev/cu.usbmodemv121` on macOS or `/dev/ttyACM0` on Linux). |
| `osdName` | `Homebridge` | CEC OSD name advertised by the adapter (up to 14 characters). |
| `hdmiPort` | *(unset)* | Optional HDMI port number (`1`–`15`) passed as `-p`. |
| `holdMode` | `longPress` | `longPress` (Single Press `<400ms` / Long Press `>=400ms`) or `repeat` (repeated Single Press every `150ms`) for HomeKit switches. |
| `holdDelayMs` | `400` | Threshold in milliseconds before hold behavior activates. |
| `holdRepeatMs` | `150` | Repeat interval in milliseconds while Volume Up/Down is held. |
| `holdSafetyMs` | `5000` | Safety timeout in milliseconds in case a CEC release (`0x45`) frame is dropped. |
| `rescanIntervalSec` | `0` | Optional periodic bus rescan interval in seconds (`0` = startup & unknown traffic only). |
| `trinnovControl` | `auto` | `auto` (send to Trinnov TCP `44100` if discovered/configured), `enabled`, or `disabled`. |
| `trinnovHost` | *(auto-discover)* | Optional manual Trinnov IP/hostname override. |
| `trinnovPort` | `44100` | Trinnov automation protocol TCP port. |
| `trinnovVolumeStepDb` | `1` | Volume step in dB sent via `dvolume` on each press/repeat tick (e.g. `0.5` or `1`). |
| `trinnovMuteAction` | `toggle` | `toggle` (`mute 2`) or `ignore`. |
| `trinnovDiscoveryUrl` | *(unset)* | Optional `homebridge-trinnov` HTTP discovery URL (`GET /api/cec/targets`). |
| `trinnovClientId` | `homebridge-pulse8-appletv-cec` | Identifier sent in the Trinnov `id` handshake. |
| `trinnovIdleTimeoutMs` | `60000` | Idle disconnect timeout in ms before sending `bye` (`0` = keep open). |
| `devices` | `[]` | Optional filter/override list to rename, select, disable, or bind specific Apple TVs to specific Trinnov targets. |

---

## Development & Testing

```bash
npm install
npm test
```
