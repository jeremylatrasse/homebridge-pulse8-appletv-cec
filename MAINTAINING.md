# Building & Maintaining `homebridge-pulse8-appletv-cec`

This guide documents everything required to build, extend, test, version, and release `homebridge-pulse8-appletv-cec` across Node.js, Homebridge Config UI X, Xcode, and GitHub.

---

## 1. Architecture & File Map

| Path | Role |
| :--- | :--- |
| [src/index.ts](src/index.ts) | Homebridge CommonJS entry point (`export = (api) => ...`). |
| [src/settings.ts](src/settings.ts) | Defines `PLUGIN_NAME` (`homebridge-pulse8-appletv-cec`) and `PLATFORM_NAME` (`Pulse8AppleTvCec`). |
| [src/platform.ts](src/platform.ts) | `Pulse8AppleTvCecPlatform` (`DynamicPlatformPlugin`), config normalization (`normalizePlatformConfig`), accessory reconciliation, and action routing. |
| [src/platformAccessory.ts](src/platformAccessory.ts) | `Pulse8AppleTvAccessory`: HomeKit `StatelessProgrammableSwitch` buttons, optional `OccupancySensor`/`Switch`, and `sanitizeHomeKitName`. |
| [src/cecClient.ts](src/cecClient.ts) | `Pulse8CecClient`: `cec-client` process lifecycle, binary resolution, `scan` parser, traffic frame parser, hold ramping, and power state debouncing. |
| [src/targetDiscovery.ts](src/targetDiscovery.ts) | `TargetResolver`: discovers external targets from overrides, HTTP endpoints, storage discovery files, and Homebridge `config.json`. |
| [src/targetDriver.ts](src/targetDriver.ts) | `TargetDriverPool`, `TcpTargetDriver`, `HttpTargetDriver`, template interpolation, and built-in AVR presets (Trinnov, Anthem, Denon/Marantz, Pioneer, StormAudio, Lyngdorf). |
| [src/trinnovClient.ts](src/trinnovClient.ts) | Backward-compatible wrapper/re-exports for legacy `trinnov*` types and helpers. |
| [config.schema.json](config.schema.json) | Homebridge Config UI X schema (`pluginAlias` must equal `PLATFORM_NAME`). |
| [test-cec.mjs](test-cec.mjs) | Node unit/protocol test suite executed against compiled `dist/` via `npm test`. |
| [homebridge-pulse8-appletv-cec/main.swift](homebridge-pulse8-appletv-cec/main.swift) | macOS Swift diagnostic CLI (`--list`, `--scan`, `--monitor`) built by the Xcode target. |
| [dist/](dist/) | **Tracked in git** compiled output for zero-compile GitHub installations. |

---

## 2. Core Design Rules (Do Not Break)

### A. Zero-Compile GitHub Installs
Homebridge users often install directly from GitHub (`npm install git+https://github.com/jeremylatrasse/homebridge-pulse8-appletv-cec.git`) on systems without `typescript` or `devDependencies`.
1. **Always commit updated `dist/` files** whenever `src/` changes. (`.gitignore` intentionally keeps `dist/` tracked.)
2. **Keep `"dependencies": {}` empty** in `package.json`. Use Node.js built-ins (`node:net`, `node:http`, `node:https`, `node:child_process`, `node:fs`, `node:readline`, global `fetch`) and put `@types/node`, `homebridge`, and `typescript` in `devDependencies`.
3. **Never add `"prepare"` or `"postinstall"` scripts** in `package.json`—they run during `npm install` on target Homebridge hosts and can fail in restricted environments. Use `"prepublishOnly": "npm run compile"` instead.
4. **Keep CommonJS entry export** (`export = (api: API) => ...`) in `src/index.ts`, and resolve scoped platform names safely in `src/platform.ts`:
   ```ts
   this.registeredPlatformName = this.config.platform
     ? String(this.config.platform).split('.').pop() || PLATFORM_NAME
     : PLATFORM_NAME;
   ```

### B. Child Bridge & Hardware Resilience
* Never throw uncaught exceptions during startup or `didFinishLaunching` if `cec-client` is missing, the Pulse-Eight adapter is unplugged, or a TCP/HTTP target is offline.
* `resolveCecClientPath()` checks `PATH` plus standard macOS/Linux directories (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, etc.) because `launchd`/`systemd`/Docker often omit Homebrew paths.
* On `cec-client` exit or spawn failure, `Pulse8CecClient` logs clear diagnostics and retries with backoff (`3s` → `15s` → `30s`, or `60s` for missing binary/`ENOENT`/`EACCES`).
* On Homebridge `shutdown`, stop `cecClient`, `targetResolver`, and `driverPool` (sending `q` + `SIGTERM` to `cec-client` and `bye` to open TCP sockets) so the serial port is never left locked.

---

## 3. HDMI-CEC Protocol & State Machine (`src/cecClient.ts`)

`cec-client` is spawned as a CEC Audio System (`-t a`, Logical Address `5`) with raw traffic output (`-d 8`), optional `-o <osdName>` (max 14 chars), optional `-p <hdmiPort>`, and optional `<portPath>`.

### Frame Handling Rules
Let `<src>` be the Apple TV's dynamically discovered logical address nibble (fallback playback addresses: `3`, `4`, `6`, `8`, `b` while `discoveredAppleTvs` is empty):

| Incoming Frame | Meaning | Required Behavior |
| :--- | :--- | :--- |
| `>> <src>5:70` | System Audio Mode Request | Send `tx 5F:72:01` |
| `>> <src>5:7d` | Give System Audio Mode Status | Send `tx 5F:72:01` |
| `>> <src>5:71` | Give Audio Status | Reply `tx 5<src>:7a:32` (50%, unmuted) |
| `>> <src>5:8f` | Give Device Power Status | Reply `tx 5<src>:90:00` (Power = On) |
| `>> <src>f:84` | Report Physical Address | **Skip** (do not spam `tx 5F:72:01` on bus broadcasts) |
| `>> <src>5:44:41` / `42` | Volume Up / Down Pressed | Emit immediate direct target command; after `holdDelayMs` (`400ms`), repeat every `holdRepeatMs` (`150ms`); stop at `holdSafetyMs` (`5000ms`). HomeKit switch emits `LONG_PRESS` (`longPress`) or repeated `SINGLE_PRESS` (`repeat`). |
| `>> <src>5:44:43` | Mute Pressed | Stop active hold; emit `mute` (`SINGLE_PRESS`) and `muteToggle` target action. |
| `>> <src>5:45` | User Control Released | Stop active hold; emit `SINGLE_PRESS` if `holdMode === 'longPress'` and `longFired === false`. |
| `>> <src>f:82`, `<src>0:04`, `<src>f:04` | Active Source / Image View On | Send `tx 5F:72:01` and record debounced power ON (`bus`). |
| `>> <src>f:36` | Standby | Stop active hold and record debounced power OFF (`bus`). |
| `>> <src>5:44:40`, `6b`, `6c`, `6d` | Remote Power Keys | Ignored when `powerKeyMode === 'ignore'`; handled when `'handle'`. |

> **Important:** Initial bus power state per logical address starts as `null` (unknown) so a `Standby` (`0x36`) frame still emits `OFF` even if the Apple TV was already awake when Homebridge booted.

---

## 4. HomeKit Accessories & Target Dispatch

### HomeKit Services (`src/platformAccessory.ts`)
* Each discovered Apple TV gets one `PlatformAccessory` with:
  * `ServiceLabel` (`ARABIC_NUMERALS`)
  * `StatelessProgrammableSwitch`: `Volume Up` (`1`), `Volume Down` (`2`), `Mute` (`3`)
  * Optional `Power On` (`4`) & `Power Off` (`5`) switches when `includePowerButtons: true`
  * Optional `OccupancySensor` (`powerSensorType: 'occupancy'`) or `Switch` (`powerSensorType: 'switch'`)
* **UUID Stability:** Keep `uuidSeed` logic in `src/platform.ts` unchanged (`pulse8-appletv-cec:${override.id}` or `pulse8-appletv-cec:${portKey}:${device.logicalAddress}:${device.physicalAddress}`) so existing Apple Home automations do not break across upgrades.
* **Empty Scan Guard:** `reconcileDiscoveredAppleTvs()` intentionally returns early if a scan returns 0 Apple TVs so sleeping Apple TVs are not purged from HomeKit cache.

### Target Resolution Priority (`src/targetDiscovery.ts`)
Per-Apple TV target selection resolves in this order:
1. `devices[].targetEnabled === false` (or `trinnovEnabled === false`) or `targetMode === 'disabled'` → HomeKit only.
2. Explicit per-device override (`devices[].targetHost` / `trinnovHost` / `httpEndpoints`).
3. Explicit per-device target match (`devices[].targetId` / `trinnovId`).
4. Global platform override (`targetHost` / `trinnovHost` / `httpEndpoints`).
5. Auto-discovered candidates (`targetDiscoveryUrl` HTTP → `<storagePath>/homebridge-cec-targets.json` & `homebridge-*-discovery.json` → Homebridge `config.json` built-in presets, AV keywords, and `targetAutodetectPlugins`).

### Backward Compatibility (`normalizePlatformConfig`)
Whenever adding or renaming config options, keep legacy `trinnov*` keys mapped in `normalizePlatformConfig()` (`src/platform.ts`) and keep `config.schema.json` defaults conservative so existing users do not unexpectedly receive new HomeKit tiles or unintended power-off commands.

---

## 5. `config.schema.json` & Config UI X Rules

Homebridge Config UI X uses `@ng-formworks/core`, which automatically renders any bounded `"integer"` (or `"number"` with `"multipleOf"`) as a **range slider** (`<input type="range">`) instead of a numeric text box.

* **Mandatory Rule:** Every field in `config.schema.json` that has `"minimum"` AND `"maximum"` with `"type": "integer"` (or `"type": "number"` + `"multipleOf"`) **must** include:
  ```json
  "x-schema-form": {
    "type": "number"
  }
  ```
* Never use `"widget": "range"` or `"type": "range"`.
* Keep `pluginAlias` (`"Pulse8AppleTvCec"`) identical to `PLATFORM_NAME` in `src/settings.ts`.

### Slider Audit Command
Run this from the project root after any `config.schema.json` edit to verify valid JSON and zero unintended sliders (should print an empty table):

```bash
node -e '
const fs = require("fs");
const root = JSON.parse(fs.readFileSync("config.schema.json", "utf8"));
const hits = [];
function walk(node, path) {
  if (!node || typeof node !== "object") return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  const isBounded = Object.hasOwn(node, "minimum") && Object.hasOwn(node, "maximum");
  const isSliderType = types.includes("integer") || (types.includes("number") && Object.hasOwn(node, "multipleOf"));
  const hasOverride = Boolean(
    node["x-schema-form"]?.type ||
    node["x-schema-form"]?.widget?.component ||
    typeof node["x-schema-form"]?.widget === "string" ||
    node.widget?.component ||
    typeof node.widget === "string"
  );
  if (isBounded && isSliderType && !hasOverride && path !== "schema.properties._bridge.properties.port") {
    hits.push({ path, type: node.type, minimum: node.minimum, maximum: node.maximum });
  }
  if (node.properties && typeof node.properties === "object") {
    for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.properties.${k}`);
  }
  if (node.items) {
    if (Array.isArray(node.items)) node.items.forEach((v, i) => walk(v, `${path}.items[${i}]`));
    else walk(node.items, `${path}.items`);
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((v, i) => walk(v, `${path}.${key}[${i}]`));
  }
}
walk(root.schema, "schema");
console.table(hits);
if (hits.length > 0) process.exit(1);
'
```

---

## 6. Local Development, Testing & Xcode Workflow

### Node / TypeScript Commands
```bash
npm install          # Install devDependencies locally
npm run compile      # Compile src/ -> dist/ via tsc
npm run watch        # Incremental compile during development
npm test             # Compiles TypeScript and runs test-cec.mjs
```

### Checklist When Modifying Features or Config
1. Update TypeScript source in `src/`.
2. If adding or changing config keys:
   * Update `normalizePlatformConfig()` / types in `src/platform.ts`.
   * Update `config.schema.json` (remembering `"x-schema-form": { "type": "number" }` for bounded integers).
   * Update the Configuration Reference in `README.md`.
3. Add or update assertions in `test-cec.mjs`.
4. Run `npm test` (which rebuilds `dist/` and runs all unit/mock-socket/CEC tests) and run the slider audit command above.
5. Verify `git status` includes updated `dist/` files alongside `src/`.

### Xcode Workflow (`⌘B` / `⌘R`)
* Opening `homebridge-pulse8-appletv-cec.xcodeproj` provides a native macOS scheme:
  * **Build (`⌘B`)** runs the **Compile TypeScript** shell build phase (`./node_modules/.bin/tsc` → `dist/`) and compiles `homebridge-pulse8-appletv-cec/main.swift`.
  * **Run (`⌘R`)** builds and runs the Swift diagnostic CLI (`--list`, `--scan`, `--monitor`, `--port`, `--cec-client`).

---

## 7. Git Versioning, Hooks & Release Pipeline

### Local Git Hooks (`.git/hooks/`)
This repository uses local hooks (`pre-commit`, `post-commit`, `pre-push`) to keep versions synchronized across npm and Xcode:
* **`pre-commit`:** Automatically increments the patch version in `package.json`, `package-lock.json`, and `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` inside `homebridge-pulse8-appletv-cec.xcodeproj/project.pbxproj`, and stages `package.json` and `package-lock.json`.
* **`post-commit`:** Ensures partial/IDE commits (e.g., Xcode Source Control UI) include the bumped version files and creates/updates the local `vX.Y.Z` tag.
* **Bypass bumping when needed** (e.g., amending or keeping an explicit version):
  ```bash
  SKIP_VERSION_BUMP=1 git commit -m "..."
  ```

### GitHub Actions (`.github/workflows/version-bump.yml`)
* On every push to `main` (except `chore(release):` bot commits), CI checks out the repo and creates/updates the `vX.Y.Z` git tag matching `package.json`.
* **Do not** add a second unconditional `npm version patch` step in CI while local `pre-commit` hooks are active, or every commit will be double-bumped.

### Publishing to npm & `homebridge/verified` Checklist
1. Inspect what will be included in the npm tarball (`.npmignore` excludes `src/`, tests, Xcode project, `.github/`, and local docs):
   ```bash
   npm pack --dry-run
   ```
2. Run `npm test` and confirm clean `git status`.
3. Publish (runs `prepublishOnly` → `npm run compile`):
   ```bash
   npm publish --access public
   ```
4. Before submitting or updating `github.com/homebridge/verified`:
   * Published publicly on npm with `"homebridge-plugin"` in `package.json` `keywords`.
   * Valid `config.schema.json` at root, `pluginAlias` matching `src/settings.ts`, and zero slider fields.
   * Child Bridge safe when `cec-client`, USB hardware, or network targets are unavailable.
   * `README.md` documents installation, `libcec` prerequisites, Apple TV settings, and configuration options.
