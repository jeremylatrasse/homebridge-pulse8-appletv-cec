# homebridge-pulse8-appletv-cec

A Homebridge dynamic platform plugin that uses a **Pulse-Eight USB-CEC Adapter** (`cec-client` / `libcec`) to capture Apple TV Siri Remote HDMI-CEC button presses (**Volume Up**, **Volume Down**, **Mute**, and optional **Power**) and Apple TV wake/standby bus state—exposing native HomeKit services and optionally dispatching commands directly to **any AVR, AV processor, or HTTP webhook** (with zero-config `homebridge-trinnov` and Homebridge `config.json` auto-discovery).

This lets Homebridge users whose amplifiers, AV processors, soundbars, or projectors do **not** implement HDMI-CEC trigger any HomeKit automation or send low-latency volume, mute, and power commands straight from their Apple TV remote.

---

## Features

- **Native HomeKit Programmable Switches (Always Active):** Exposes **Volume Up**, **Volume Down**, and **Mute** (plus optional **Power On** / **Power Off**) as `StatelessProgrammableSwitch` buttons in Apple Home—compatible with every Homebridge plugin via standard HomeKit automations.
- **Optional Apple TV Power / Activity Sensor:** Optionally expose a debounced `OccupancySensor` or `Switch` per Apple TV driven by HDMI-CEC `Active Source` (`0x82`) / `Image View On` (`0x04`) and `Standby` (`0x36`).
- **Pluggable Action Target Drivers (`targetMode`):**
  - **`auto` (Default):** Automatically discovers targets from Homebridge discovery files, HTTP discovery endpoints, or Homebridge's `config.json` (falling back cleanly to HomeKit-only mode if none are present).
  - **`trinnov`:** Direct Trinnov TCP `44100` preset (`id` handshake, `dvolume`, `mute 2`, `bye`).
  - **`tcp`:** Generic persistent TCP/Telnet driver with customizable `init`, `volumeUp`, `volumeDown`, `mute`, `powerOn`, `powerOff`, `powerToggle`, and `bye` templates (supports `{{stepDb}}`, `{{-stepDb}}`, `{{clientId}}`, `{{source}}`, escaped `\r`/`\n`, and `hex:...` binary payloads).
  - **`http`:** Generic HTTP webhook / REST API driver (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`, custom headers, JSON/text templates).
  - **`disabled`:** HomeKit accessories only.
- **Automatic Homebridge Target Discovery:**
  1. `<storagePath>/homebridge-cec-targets.json` (v1 generic multi-plugin discovery file)
  2. `<storagePath>/homebridge-*-discovery.json` (wildcard scan, including `homebridge-trinnov-discovery.json`)
  3. Optional HTTP discovery endpoint (`GET /api/cec/targets`)
  4. Automatic fallback scan of Homebridge's `config.json` for built-in AVR/processor presets (**Trinnov**, **Anthem**, **Denon/Marantz**, **Pioneer**, **StormAudio**, **Lyngdorf**, **Yamaha**), common AV/TV plugin keywords, explicit `cecTarget` / `tcpCommands` / `httpEndpoints` fields, or user-defined `targetAutodetectPlugins`.
- **Tap & Hold Ramping Support:**
  - **HomeKit Switches (`longPress` default):** Short tap emits `Single Press`; holding past `400ms` emits `Long Press` once (or set `holdMode` to `repeat` for repeated `Single Press` ticks).
  - **Direct Targets (TCP / HTTP):** Always emits an immediate step on press and continuously repeats every `150ms` while held until release (`0x45`) or `5s` safety timeout.
- **Dynamic Apple TV Discovery (`scan`):** Runs `cec-client` `scan` automatically on startup rather than hardcoding Logical Address `4`. Each discovered Apple TV gets its own HomeKit accessory (unless filtered in `config.json`).
- **System Audio Mode Persistence:** Emulates a CEC Audio System (`-t a`, Logical Address `5`) and replies to tvOS status/power polls (`tx 5F:72:01`, `tx 5<src>:7a:32`, `tx 5<src>:90:00`) so the Siri Remote stays locked in HDMI-CEC volume mode across wakes.
- **Clean Shutdown & Auto-Respawn:** Gracefully terminates `cec-client` and closes active target sockets (`bye`) on Homebridge `shutdown`.

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

## Configuration Examples

### HomeKit-Only Automations (No External IP Target)
```json
{
  "platform": "Pulse8AppleTvCec",
  "targetMode": "disabled",
  "powerSensorType": "occupancy"
}
```

### Generic TCP AVR (e.g., Anthem AVM / MRX)
```json
{
  "platform": "Pulse8AppleTvCec",
  "targetMode": "tcp",
  "targetHost": "192.168.1.60",
  "targetPort": 14999,
  "tcpCommands": {
    "volumeUp": "Z1VUP;",
    "volumeDown": "Z1VDN;",
    "mute": "Z1MUT;",
    "lineEnding": "\\n"
  }
}
```

### HTTP Webhook / REST API (e.g., Home Assistant)
```json
{
  "platform": "Pulse8AppleTvCec",
  "targetMode": "http",
  "httpEndpoints": {
    "volumeUp": "http://192.168.1.10:8123/api/webhook/atv_vol_up",
    "volumeDown": "http://192.168.1.10:8123/api/webhook/atv_vol_down",
    "mute": "http://192.168.1.10:8123/api/webhook/atv_mute"
  }
}
```

---

## Cross-Plugin Discovery Contract (`v1`)

Other Homebridge plugins (such as `homebridge-trinnov`) can publish targets automatically for both **same-process** and **Child Bridge** setups via `<api.user.storagePath()>/homebridge-cec-targets.json` or `<storagePath>/homebridge-*-discovery.json` (and optionally `GET /api/cec/targets`):

```json
{
  "version": 1,
  "plugin": "homebridge-trinnov",
  "updatedAt": "2026-11-18T15:00:00.000Z",
  "pid": 12345,
  "http": {
    "baseUrl": "http://127.0.0.1:44180",
    "targetsPath": "/api/cec/targets"
  },
  "targets": [
    {
      "id": "theater-trinnov",
      "name": "Theater Altitude 32",
      "driver": "trinnov",
      "host": "192.168.1.50",
      "port": 44100,
      "powered": true,
      "activeSource": "Apple TV",
      "volumeStepDb": 0.5
    }
  ]
}
```
*(Legacy `"processors"` arrays from `homebridge-trinnov-discovery.json` are also supported.)*

### Target Resolution Priority (Per Apple TV)

1. `devices[].targetEnabled === false` (or legacy `trinnovEnabled === false`) or `targetMode === "disabled"` → Do not send to external target.
2. `devices[].targetHost` (or `trinnovHost`) / `devices[].httpEndpoints` → Explicit per-Apple TV override.
3. `devices[].targetId` (or `trinnovId`) → Match discovered target by `id` or `name`.
4. `targetHost` (or `trinnovHost`) / `httpEndpoints` → Global platform override.
5. Auto-discovered targets (`HTTP discovery` → discovery files → Homebridge `config.json`): matches `activeSource` against the Apple TV name, then `powered === true`, then actionable preset targets first.

---

## Configuration Reference

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
| `powerSensorType` | `none` | Optional Apple TV power service: `none`, `occupancy`, or `switch`. |
| `includePowerButtons` | `false` | Optionally expose stateless `Power On` and `Power Off` buttons in HomeKit. |
| `powerKeyMode` | `ignore` | `ignore` or `handle` CEC remote power keys (`44:40`, `44:6b`, `44:6c`, `44:6d`). |
| `powerDebounceMs` | `1500` | Debounce settle window in ms against rapid CEC power flicker. |
| `ignoreStandbyAfterWakeMs` | `0` | Optional guard window in ms to ignore spurious `0x36` Standby right after wake (`0` = disabled). |
| `targetMode` | `auto` | `auto`, `trinnov`, `tcp`, `http`, or `disabled` (legacy alias: `trinnovControl`). |
| `targetHost` | *(auto-discover)* | Optional manual target IP/hostname override (legacy alias: `trinnovHost`). |
| `targetPort` | *(driver default)* | Target TCP/HTTP port (`44100` for Trinnov, `23` for TCP, `80` for HTTP; legacy alias: `trinnovPort`). |
| `targetVolumeStepDb` | `1` | Volume step value interpolated as `{{stepDb}}` (legacy alias: `trinnovVolumeStepDb`). |
| `targetMuteAction` | `toggle` | `toggle` or `ignore` (legacy alias: `trinnovMuteAction`). |
| `targetPowerMode` | `keysOnly` | `keysOnly`, `all` (bus wake/standby + remote keys), or `none`. |
| `targetDiscoveryUrl` | *(unset)* | Optional HTTP discovery URL (`GET /api/cec/targets`; legacy alias: `trinnovDiscoveryUrl`). |
| `targetClientId` | `homebridge-pulse8-appletv-cec` | Client identifier interpolated as `{{clientId}}` during TCP init (legacy alias: `trinnovClientId`). |
| `targetIdleTimeoutMs` | `60000` | Idle TCP disconnect timeout in ms (`0` = keep open; legacy alias: `trinnovIdleTimeoutMs`). |
| `targetAutodetectPlugins` | `[]` | Additional Homebridge platform/accessory names to scan in `config.json`. |
| `tcpCommands` | *(preset)* | Custom command templates for `tcp` targets (`init`, `volumeUp`, `volumeDown`, `mute`, `powerOn`, `powerOff`, `powerToggle`, `bye`, `lineEnding`). |
| `httpEndpoints` | *(unset)* | Custom URL / `{ url, method, headers, body }` definitions for `http` targets. |
| `devices` | `[]` | Optional filter/override list to rename, select, disable, or bind specific Apple TVs to specific targets. |

---

## Development & Testing

```bash
npm install
npm test
```
