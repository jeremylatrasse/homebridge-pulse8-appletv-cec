
# homebridge-pulse8-appletv-cec — Handoff Specification

## 1. Project Identity & Reference Template
- **Directory & npm package name:** `homebridge-pulse8-appletv-cec`
- **Purpose:** Homebridge dynamic platform plugin that uses a Pulse-Eight USB-CEC adapter (`cec-client`) to capture Apple TV HDMI-CEC remote/power events and expose them as **native HomeKit accessories** so users can forward them to non-CEC devices (amplifiers, projectors, or any other Homebridge-connected device) via HomeKit automations.
- **Structure & Style Reference:** Match `/Users/avalo/Documents/homebridge-panamax-43xx`:
  - Read `homebridge-panamax-43xx/src/platform.ts` (and related `src/` + config files) before scaffolding.
  - `package.json` baseline:
    - TypeScript `^5.4.0`, `homebridge` `^1.8.0`, `@types/node` `^20.12.0`, Node `>=18.0.0`, Homebridge `>=1.6.0`, license `Apache-2.0`.
    - Scripts: `compile` (`tsc`), `watch` (`tsc --watch`), `prepublishOnly` (`npm run compile`), `test`, `bump` (`npm version patch --no-git-tag-version`).
    - `allowScripts` pattern matching `homebridge-panamax-43xx`.

---

## 2. `cec-client` Process & Dynamic Discovery
- **Spawn command:** `cec-client -t a -d 8 [portPath]` (Emulate CEC Audio System at Logical Address `5`; `-d 8` outputs raw `TRAFFIC:` hex frames).
  - `cecClientPath` configurable (default: `cec-client`).
  - `portPath` configurable (optional/auto-detect by default; e.g. `/dev/cu.usbmodemv121` on macOS, `/dev/ttyACM0` on Linux).
- **Ready & Keep-Alive:**
  - Detect adapter readiness on `waiting for input` (with fallback detection if `libcec` output varies) and send `tx 5F:72:01` to claim System Audio Mode.
  - Cleanly kill child process (`SIGTERM`) on Homebridge `shutdown` so the serial port is not left locked; respawn after `3000ms` on unexpected exit.
- **Dynamic Apple TV Discovery (`scan`):**
  - Run `scan` via `cec-client` instead of hardcoding Logical Address `4` (`Playback 1`).
  - Parse discovered Apple TV(s) (logical address, physical address, OSD/vendor name).
  - **Multiple Apple TVs:** Automatically create separate HomeKit accessories for every discovered Apple TV unless filtered in `config.json` (e.g., by logical address, physical address, or name).

---

## 3. Confirmed CEC Opcode Handling & Fixes
Let `<src>` be the dynamically matched initiator nibble for the Apple TV (e.g. `4`, `8`, `b`):

| Incoming Frame | Meaning | Action / Reply |
| :--- | :--- | :--- |
| `>> <src>5:70` | System Audio Mode Request | Reply `tx 5F:72:01` (Set System Audio Mode: On) |
| `>> <src>5:7d` | Give System Audio Mode Status | Reply `tx 5F:72:01` |
| `>> <src>5:71` | Give Audio Status | Reply `tx 5<src>:7a:32` (Report Audio Status) |
| `>> <src>5:8f` | Give Device Power Status | Reply `tx 5<src>:90:00` (Report Power = On) |
| `>> <src>f:84` | Report Physical Address | **Do NOT** spam `tx 5F:72:01` on every broadcast |
| `>> <src>5:44:41` | Volume Up Pressed | Trigger Volume Up + start hold-ramping |
| `>> <src>5:44:42` | Volume Down Pressed | Trigger Volume Down + start hold-ramping |
| `>> <src>5:44:43` | Mute Pressed | Trigger Mute |
| `>> <src>5:45` | User Control Released | Stop active hold-ramp timer |
| `>> <src>5:44:40` / `44:6c` | Power Toggle / Power Off button | **IGNORED for now** (user requested skipping remote power button) |
| `>> <src>f:82` / `<src>0:04` / `<src>f:04` | Active Source / Image View On | Wake / Active state + `tx 5F:72:01` (debounced) |
| `>> <src>f:36` | Standby | Standby / Inactive state (debounced) |

### Confirmed Edge-Case Behavior
- **Initial Power State (`null`):** Initialize state as `null` (unknown) rather than `false`, so an incoming `Standby` (`<src>f:36`) still emits `OFF` even if Homebridge started while the Apple TV was already awake.
- **Wake-Storm Debouncing:** Deduplicate rapid wake bursts (`04` + `82`) using `powerDebounceMs` (e.g. `1500ms`).
- **Hold-Ramping Timers:** `400ms` initial delay after `44:41` / `44:42` before repeating every `150ms`, with a hard `5000ms` safety cutoff if `45` (User Control Released) is missed.

---

## 4. HomeKit Accessories & Open Questions to Confirm First
- **Confirmed HomeKit Services:** Expose native `StatelessProgrammableSwitch` buttons per Apple TV for **Volume Up**, **Volume Down**, and **Mute** (Power Toggle button omitted for now).
- **2 Quick Confirmations Needed Before Coding in New Project:**
  1. **Wake / Standby (`<src>f:82`, `<src>0:04`, `<src>f:36`):** Since the remote power button (`44:40`/`44:6c`) is ignored, should Apple TV Wake/Standby bus broadcasts still be exposed as a HomeKit `Switch` or `OccupancySensor` (and/or `process.emit('theater:cec-power', ...)`), or omitted for now?
  2. **Hold-Ramping Mapping on `StatelessProgrammableSwitch`:** When Volume Up/Down is held past `400ms` until `45` (or `5s` cutoff), should HomeKit emit `LONG_PRESS` once, or repeatedly emit `SINGLE_PRESS` every `150ms` so HomeKit automations step volume continuously?
