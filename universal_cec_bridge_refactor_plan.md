# Architecture & Refactor Plan: Making `homebridge-pulse8-appletv-cec` Processor-Agnostic

## Overview
To make `homebridge-pulse8-appletv-cec` universally useful across any home theater or stereo setup (Anthem, StormAudio, Datasat, Emotiva, Denon/Marantz, McIntosh, stereo preamps, or IR-only soundbars) while keeping `homebridge-trinnov` integration zero-config, decouple **CEC capture & HomeKit exposure** from **target command execution**.

---

## 1. Pluggable Target Sink / Driver Architecture

Split the plugin into two clean layers:
1. **CEC Engine & HomeKit Accessory Layer (Core):**
   - Emulates a CEC Audio System (`-t a`, Logical Address `5`) and maintains `System Audio Mode`.
   - Dynamically discovers playback sources via `cec-client` `scan`.
   - Exposes native HomeKit services (`StatelessProgrammableSwitch` buttons and optional `OccupancySensor` / `Switch`).
   - Emits normalized semantic actions: `volumeUp`, `volumeDown`, `muteToggle`, `powerOn`, `powerOff`, `powerToggle`.
2. **Action Target Drivers (Pluggable Sinks):**
   - **`homekit` (Always Active / Default):** Exposes buttons and power state to Apple Home so any user can trigger scenes or control other Homebridge accessories with zero IP configuration.
   - **`tcp` (Generic Raw Socket Driver):** Sends customizable ASCII/hex strings over a persistent TCP socket with configurable `init`, `volumeUp`, `volumeDown`, `mute`, `powerOn`, `powerOff`, `powerToggle`, and `bye` commands. Covers **Trinnov (`44100`)**, **Anthem (`14999`)**, **Denon/Marantz (`23`)**, **Pioneer (`23`)**, **StormAudio (`23`)**, **Lyngdorf (`84`)**, and custom TCP/hex receivers via config alone or auto-detected presets.
   - **`http` (Webhook / REST Driver):** Fires configurable HTTP requests (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`, custom headers, JSON/text body) for Yamaha YXC, Home Assistant webhooks, Node-RED, Sonos HTTP APIs, or BroadLink/Global Caché IP bridges.
   - **`trinnov` (First-Class Auto-Discovered Preset):** Automatically configures the TCP driver with Trinnov defaults (`port: 44100`, `id` handshake, `dvolume`, `mute 2`, `bye`) when `homebridge-trinnov` is discovered or selected.

---

## 2. Generalized Cross-Plugin Discovery Contract

Generalize the discovery file convention so any Homebridge AVR, preamp, or amplifier plugin can advertise itself as a CEC audio/power target without tight coupling:

### Discovery File Locations (Checked in Order)
1. `<storagePath>/homebridge-cec-targets.json` (new generic standard)
2. `<storagePath>/homebridge-*-discovery.json` (wildcard scan—automatically picks up `homebridge-trinnov-discovery.json`, `homebridge-anthem-discovery.json`, etc.)
3. Optional HTTP discovery endpoint (`GET /api/cec/targets`) for cross-container or remote-host setups.
4. Homebridge `config.json` fallback auto-detection: scans all configured `platforms[]` and `accessories[]` for built-in AVR presets (`trinnov`, `anthem`, `denon`, `marantz`, `pioneer`, `stormaudio`, `lyngdorf`, `yamaha`), AV/TV keywords (`avr`, `receiver`, `amplifier`, `preamp`, `processor`, `soundbar`, `sonos`, `onkyo`, `integra`, `arcam`, `emotiva`, `nad`, `rotel`, `mcintosh`, `lexicon`, `datasat`, `webos`, `bravia`, `tizen`, `vizio`, `roku`, `bose`), explicit `cecTarget` / `tcpCommands` / `httpEndpoints` properties, or user-configured `targetAutodetectPlugins`.

### Generic Discovery JSON Schema (`v1`)
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
      "id": "theater-processor",
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
*(Note: Keeps backward compatibility with the `"processors"` array key in `homebridge-trinnov-discovery.json`.)*

---

## 3. Generalized Configuration Schema (`config.schema.json`)

Migrate top-level `trinnov*` configuration keys to generic `target*` keys while keeping `trinnov*` as supported backward-compatible aliases:

| New Generic Key | Legacy Alias | Default | Description |
| :--- | :--- | :--- | :--- |
| `targetMode` | `trinnovControl` | `auto` | `auto` (auto-discover plugins), `tcp`, `http`, `trinnov`, or `disabled` (HomeKit only). |
| `targetHost` | `trinnovHost` | *(auto)* | IP address or hostname of the target AVR/processor/bridge. |
| `targetPort` | `trinnovPort` | *(driver default)* | TCP/HTTP port (e.g. `44100` for Trinnov, `14999` for Anthem, `23` for Denon). |
| `targetDiscoveryUrl` | `trinnovDiscoveryUrl` | *(unset)* | Optional HTTP URL (`GET /api/cec/targets`) for cross-host discovery. |
| `targetIdleTimeoutMs` | `trinnovIdleTimeoutMs` | `60000` | Idle socket timeout in ms before sending `bye` and closing (`0` = stay connected). |
| `targetAutodetectPlugins` | — | `[]` | Extra Homebridge platform/accessory names to include when auto-detecting targets from `config.json`. |
| `targetPowerMode` | — | `keysOnly` | `none`, `keysOnly` (forward remote power keys when `powerKeyMode: "handle"`), or `all` (bus wake/standby + keys). |
| `tcpCommands` | — | *(preset)* | Custom command templates for the `tcp` driver (`init`, `volumeUp`, `volumeDown`, `mute`, `powerOn`, `powerOff`, `powerToggle`, `bye`). |
| `httpEndpoints` | — | *(unset)* | Custom URL/method/header/body definitions for the `http` driver. |

### Example Generic TCP Config (e.g., Anthem AVM / MRX)
```json
{
  "platform": "Pulse8AppleTvCec",
  "targetMode": "tcp",
  "targetHost": "192.168.1.60",
  "targetPort": 14999,
  "tcpCommands": {
    "volumeUp": "Z1VUP;\n",
    "volumeDown": "Z1VDN;\n",
    "mute": "Z1MUT;\n"
  }
}
```

---

## 4. Expand HomeKit Accessory Capabilities (Power & Playback State)

Even users whose AVRs *do* support HDMI-CEC often lack a reliable **"When Apple TV turns on / off"** trigger in Apple Home (for lowering projectors, closing motorized shades, or dimming theater sconces).

### Recommended HomeKit Services per Discovered Source
1. **Stateless Programmable Switches (Existing):**
   - `Volume Up` (`Single Press`, `Long Press`)
   - `Volume Down` (`Single Press`, `Long Press`)
   - `Mute` (`Single Press`)
   - *(Optional, `includePowerButtons`)* `Power On` (`Single Press`) & `Power Off` (`Single Press`)
2. **Power / Activity Sensor (Configurable: `none` | `occupancy` | `switch`, default `none`):**
   - Triggered by CEC `Active Source` (`0x82`) / `Image View On` (`0x04`) $\rightarrow$ `Active / Detected`
   - Triggered by CEC `Standby` (`0x36`) $\rightarrow$ `Inactive / Not Detected`
   - Debounced via `powerDebounceMs` (default `1500ms`) against rapid tvOS wake/standby flicker, with optional `ignoreStandbyAfterWakeMs` guard (default `0ms`).

---

## 5. Implementation Checklist for Refactor

- [x] **Extract `TargetDriver` interface** (`connect()`, `sendAction(action)`, `disconnect()`).
- [x] **Implement `TcpTargetDriver`** with persistent socket pooling, idle `bye` timer, and configurable command templates (refactor existing Trinnov TCP `44100` client to extend or preset this driver).
- [x] **Implement `HttpTargetDriver`** using native Node `fetch()` for webhook/REST targets.
- [x] **Generalize Discovery Loader** to scan `<storagePath>/homebridge-cec-targets.json`, `homebridge-*-discovery.json`, HTTP endpoints, and Homebridge `config.json` (with built-in AVR/TV presets + `targetAutodetectPlugins`), supporting both `targets` and legacy `processors` arrays.
- [x] **Add Config Alias Mapper** so existing `trinnov*` config keys seamlessly map to `target*` keys without breaking current users.
- [x] **Add Optional Power Sensor/Switch Service & Power Buttons** to the Apple TV HomeKit accessory driven by debounced `0x82` / `0x04` and `0x36` CEC frames (and optional remote power keys).
- [x] **Update `README.md` & `config.schema.json`** with examples for HomeKit-only automations, Trinnov auto-discovery, generic TCP receivers (Anthem/Denon), and HTTP webhooks.

---

## 6. Unresolved Questions & Future Defaults (To Revisit Later)

The current release keeps conservative, backward-compatible defaults (`powerSensorType: "none"`, `includePowerButtons: false`, `powerKeyMode: "ignore"`, `targetPowerMode: "keysOnly"`, `ignoreStandbyAfterWakeMs: 0`). Revisit the following questions before a future major/minor release:

1. **Default HomeKit Power Services (`powerSensorType` & `includePowerButtons`):**
   - Currently `powerSensorType` defaults to `"none"` and `includePowerButtons` defaults to `false` so existing users do not unexpectedly receive new Apple Home tiles upon upgrading.
   - *Open Question:* Should new installations default `powerSensorType` to `"occupancy"` (for effortless Apple Home "When Apple TV turns on/off" automations) while leaving existing users unchanged, or remain opt-in?
2. **HomeKit Switch Behavior (`powerSensorType === "switch"`):**
   - Currently, toggling the HomeKit `Switch` on/off triggers `powerOn` / `powerOff` on the external target driver (when `targetPowerMode !== "none"`), without transmitting HDMI-CEC wake/standby frames on the HDMI bus.
   - *Open Question:* Should toggling the Switch also send CEC frames (e.g., `tx 5<addr>:04` / `tx 5<addr>:36`) to wake/sleep the Apple TV itself, or optionally support a read-only mode?
3. **Spurious Standby Guard (`ignoreStandbyAfterWakeMs`):**
   - Currently defaults to `0` (disabled). Some TV/AVR combinations emit a spurious CEC `Standby` (`0x36`) within ~1–3 seconds after an Apple TV sends `Image View On` (`0x04`) / `Active Source` (`0x82`).
   - *Open Question:* Based on real-world hardware testing, should `ignoreStandbyAfterWakeMs` adopt a non-zero default (e.g., `2000`–`3000` ms)?
4. **Remote Power Key & Target Power Routing Defaults (`powerKeyMode` & `targetPowerMode`):**
   - Currently `powerKeyMode` defaults to `"ignore"` and `targetPowerMode` defaults to `"keysOnly"`.
   - *Open Question:* Should `targetPowerMode` default to `"none"` (requiring explicit opt-in before sending power commands to external AVRs/webhooks), or remain `"keysOnly"`?
5. **CEC Bus Audio/TV Device Autodetection:**
   - Currently autodetection inspects discovery files, HTTP endpoints, and Homebridge `config.json`.
   - *Open Question:* Should `cec-client scan` vendor/OSD output (when a TV or AVR advertises on the HDMI bus) also contribute hints when matching targets?
