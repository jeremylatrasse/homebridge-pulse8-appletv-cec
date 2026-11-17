"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pulse8AppleTvCecPlatform = void 0;
exports.matchesAppleTvFilter = matchesAppleTvFilter;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_1 = require("./settings");
const cecClient_1 = require("./cecClient");
const platformAccessory_1 = require("./platformAccessory");
const trinnovClient_1 = require("./trinnovClient");
function loadPluginVersion() {
    try {
        const pkgPath = (0, node_path_1.join)(__dirname, '..', 'package.json');
        const pkg = JSON.parse((0, node_fs_1.readFileSync)(pkgPath, 'utf8'));
        return pkg.version || '1.0.0';
    }
    catch {
        return '1.0.0';
    }
}
function matchesAppleTvFilter(device, filter) {
    if (filter.logicalAddress && filter.logicalAddress.trim().toLowerCase() !== device.logicalAddress) {
        return false;
    }
    if (filter.physicalAddress && filter.physicalAddress.trim().toLowerCase() !== device.physicalAddress.toLowerCase()) {
        return false;
    }
    if (filter.osdName && filter.osdName.trim().toLowerCase() !== device.osdString.toLowerCase()) {
        return false;
    }
    return Boolean(filter.logicalAddress || filter.physicalAddress || filter.osdName);
}
class Pulse8AppleTvCecPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    activeByLogicalAddress = new Map();
    pluginVersion = loadPluginVersion();
    cecClient = null;
    trinnovResolver = null;
    trinnovPool = null;
    trinnovMuteAction = 'toggle';
    registeredPlatformName = settings_1.PLATFORM_NAME;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.registeredPlatformName = this.config.platform
            ? String(this.config.platform).split('.').pop() || settings_1.PLATFORM_NAME
            : settings_1.PLATFORM_NAME;
        this.log.info(`Initializing Pulse-Eight Apple TV CEC Platform v${this.pluginVersion}: "${this.config.name || 'Pulse-Eight Apple TV CEC'}"`);
        this.api.on('didFinishLaunching', () => {
            this.startCecBridge();
        });
        this.api.on('shutdown', () => {
            if (this.cecClient) {
                this.cecClient.stop();
                this.cecClient = null;
            }
            if (this.trinnovResolver) {
                this.trinnovResolver.stop();
                this.trinnovResolver = null;
            }
            if (this.trinnovPool) {
                this.trinnovPool.stopAll();
                this.trinnovPool = null;
            }
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    getConfiguredDeviceFilters() {
        return Array.isArray(this.config.devices)
            ? this.config.devices
            : [];
    }
    startCecBridge() {
        const trinnovControlRaw = this.config.trinnovControl;
        const trinnovControl = trinnovControlRaw === 'enabled' || trinnovControlRaw === 'disabled'
            ? trinnovControlRaw
            : 'auto';
        this.trinnovMuteAction =
            this.config.trinnovMuteAction === 'ignore' ? 'ignore' : 'toggle';
        const resolver = new trinnovClient_1.TrinnovTargetResolver({
            mode: trinnovControl,
            host: this.config.trinnovHost,
            port: this.config.trinnovPort,
            volumeStepDb: this.config.trinnovVolumeStepDb,
            discoveryUrl: this.config.trinnovDiscoveryUrl,
            storagePath: this.api.user.storagePath(),
            configPath: this.api.user.configPath(),
        }, this.log);
        resolver.start();
        this.trinnovResolver = resolver;
        const initialCandidates = resolver.getCandidateList();
        if (this.config.trinnovHost) {
            this.log.info(`[Trinnov] Configured direct target: ${this.config.trinnovHost}:${this.config.trinnovPort ?? 44100}`);
        }
        else if (initialCandidates.length > 0) {
            const summary = initialCandidates
                .map((c) => `${c.name || c.id || 'Trinnov'} (${c.host}:${c.port} via ${c.source})`)
                .join(', ');
            this.log.info(`[Trinnov] Auto-discovered target(s): ${summary}`);
        }
        else if (trinnovControl !== 'disabled') {
            this.log.info('[Trinnov] No Trinnov target discovered yet; watching Homebridge storagePath/config for homebridge-trinnov.');
        }
        this.trinnovPool = new trinnovClient_1.TrinnovClientPool({
            clientId: this.config.trinnovClientId,
            idleTimeoutMs: this.config.trinnovIdleTimeoutMs,
        }, this.log);
        const activeFilters = this.getConfiguredDeviceFilters().filter((f) => f.enabled !== false);
        // Rehydrate cached accessories immediately so buttons remain wired if traffic arrives before scan finishes
        for (const cached of this.accessories) {
            const ctx = (cached.context || {});
            if (ctx.logicalAddress) {
                const placeholderDevice = {
                    logicalAddress: ctx.logicalAddress,
                    logicalAddressNum: parseInt(ctx.logicalAddress, 16) || 4,
                    deviceType: 'Playback',
                    physicalAddress: ctx.physicalAddress || '',
                    activeSource: false,
                    vendor: 'Apple',
                    osdString: ctx.osdString || cached.displayName,
                    isAppleTv: true,
                };
                const handler = new platformAccessory_1.Pulse8AppleTvAccessory(this, cached, placeholderDevice, cached.displayName, this.pluginVersion);
                const matchingOverride = activeFilters.find((f) => matchesAppleTvFilter(placeholderDevice, f));
                this.activeByLogicalAddress.set(ctx.logicalAddress, {
                    handler,
                    override: matchingOverride,
                    displayName: cached.displayName,
                    osdString: placeholderDevice.osdString,
                });
            }
        }
        const client = new cecClient_1.Pulse8CecClient({
            cecClientPath: this.config.cecClientPath,
            portPath: this.config.portPath,
            osdName: this.config.osdName,
            hdmiPort: this.config.hdmiPort,
            holdMode: this.config.holdMode || 'longPress',
            holdDelayMs: this.config.holdDelayMs,
            holdRepeatMs: this.config.holdRepeatMs,
            holdSafetyMs: this.config.holdSafetyMs,
            rescanIntervalSec: this.config.rescanIntervalSec,
        }, this.log);
        client.on('scanResult', ({ appleTvs }) => {
            this.reconcileDiscoveredAppleTvs(appleTvs);
        });
        client.on('keyPress', (event) => {
            const entry = this.findEntryForLogicalAddress(event.logicalAddress);
            if (entry) {
                entry.handler.triggerKeyEvent(event.key, event.pressType);
            }
        });
        client.on('volumeCommand', (event) => {
            this.handleVolumeCommand(event);
        });
        this.cecClient = client;
        client.start();
    }
    findEntryForLogicalAddress(logicalAddress) {
        const exact = this.activeByLogicalAddress.get(logicalAddress);
        if (exact) {
            return exact;
        }
        // Fallback if traffic arrived before scan completed and only 1 cached accessory exists
        if (this.activeByLogicalAddress.size === 1) {
            return Array.from(this.activeByLogicalAddress.values())[0];
        }
        return undefined;
    }
    handleVolumeCommand(event) {
        if (!this.trinnovResolver || !this.trinnovPool) {
            return;
        }
        const entry = this.findEntryForLogicalAddress(event.logicalAddress);
        const resolved = this.trinnovResolver.resolveForAppleTv({
            displayName: entry?.displayName || 'Apple TV',
            osdString: entry?.osdString || 'Apple TV',
            deviceOverride: entry?.override,
        });
        if (!resolved) {
            return;
        }
        if (event.key === 'volumeUp') {
            this.trinnovPool.adjustVolume(resolved.target, resolved.stepDb);
        }
        else if (event.key === 'volumeDown') {
            this.trinnovPool.adjustVolume(resolved.target, -resolved.stepDb);
        }
        else if (event.key === 'mute' && this.trinnovMuteAction !== 'ignore') {
            this.trinnovPool.toggleMute(resolved.target);
        }
    }
    reconcileDiscoveredAppleTvs(discoveredAppleTvs) {
        if (discoveredAppleTvs.length === 0) {
            // Do not purge cached accessories if scan found nothing (e.g. Apple TV asleep or adapter still initializing)
            return;
        }
        const filters = this.getConfiguredDeviceFilters();
        const activeFilters = filters.filter((f) => f.enabled !== false);
        const disabledFilters = filters.filter((f) => f.enabled === false);
        // Determine which discovered Apple TVs should be exposed
        const selected = [];
        for (const device of discoveredAppleTvs) {
            const isDisabled = disabledFilters.some((f) => matchesAppleTvFilter(device, f));
            if (isDisabled) {
                this.log.info(`[CEC] Skipping Apple TV (${device.osdString || 'Apple TV'}, logical=${device.logicalAddress}) because it is disabled in config.`);
                continue;
            }
            const matchingOverride = activeFilters.find((f) => matchesAppleTvFilter(device, f));
            if (activeFilters.length > 0 && !matchingOverride) {
                this.log.info(`[CEC] Skipping Apple TV (${device.osdString || 'Apple TV'}, logical=${device.logicalAddress}) because it does not match configured device filters.`);
                continue;
            }
            selected.push({ device, override: matchingOverride });
        }
        const portKey = this.config.portPath?.trim() || 'auto';
        const osdCounts = new Map();
        for (const item of selected) {
            const base = (item.override?.name?.trim() || item.device.osdString || 'Apple TV').toLowerCase();
            osdCounts.set(base, (osdCounts.get(base) ?? 0) + 1);
        }
        const activeUUIDs = new Set();
        this.activeByLogicalAddress.clear();
        for (const { device, override } of selected) {
            const rawBaseName = override?.name?.trim() || device.osdString || 'Apple TV';
            const hasDuplicateName = (osdCounts.get(rawBaseName.toLowerCase()) ?? 0) > 1;
            const disambiguatedName = hasDuplicateName
                ? `${rawBaseName} ${device.physicalAddress || device.logicalAddress.toUpperCase()}`
                : rawBaseName;
            const displayName = (0, platformAccessory_1.sanitizeHomeKitName)(disambiguatedName, 'Apple TV');
            const uuidSeed = override?.id?.trim()
                ? `pulse8-appletv-cec:${override.id.trim()}`
                : `pulse8-appletv-cec:${portKey}:${device.logicalAddress}:${device.physicalAddress || 'unknown'}`;
            const uuid = this.api.hap.uuid.generate(uuidSeed);
            activeUUIDs.add(uuid);
            const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
            if (existingAccessory) {
                this.log.info(`Restoring Apple TV CEC accessory: "${displayName}" (logical=${device.logicalAddress}, physical=${device.physicalAddress || 'unknown'})`);
                existingAccessory.displayName = displayName;
                existingAccessory.context = {
                    logicalAddress: device.logicalAddress,
                    physicalAddress: device.physicalAddress,
                    osdString: device.osdString,
                    portKey,
                };
                const handler = new platformAccessory_1.Pulse8AppleTvAccessory(this, existingAccessory, device, displayName, this.pluginVersion);
                this.activeByLogicalAddress.set(device.logicalAddress, {
                    handler,
                    override,
                    displayName,
                    osdString: device.osdString,
                });
                this.api.updatePlatformAccessories([existingAccessory]);
            }
            else {
                this.log.info(`Registering new Apple TV CEC accessory: "${displayName}" (logical=${device.logicalAddress}, physical=${device.physicalAddress || 'unknown'})`);
                const accessory = new this.api.platformAccessory(displayName, uuid);
                accessory.context = {
                    logicalAddress: device.logicalAddress,
                    physicalAddress: device.physicalAddress,
                    osdString: device.osdString,
                    portKey,
                };
                const handler = new platformAccessory_1.Pulse8AppleTvAccessory(this, accessory, device, displayName, this.pluginVersion);
                this.activeByLogicalAddress.set(device.logicalAddress, {
                    handler,
                    override,
                    displayName,
                    osdString: device.osdString,
                });
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, this.registeredPlatformName, [accessory]);
                this.accessories.push(accessory);
            }
        }
        // Remove stale cached accessories that are no longer selected
        const staleAccessories = this.accessories.filter((acc) => !activeUUIDs.has(acc.UUID));
        if (staleAccessories.length > 0) {
            this.log.info(`Cleaning up ${staleAccessories.length} stale accessory/accessories from cache.`);
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, this.registeredPlatformName, staleAccessories);
            for (const stale of staleAccessories) {
                const idx = this.accessories.indexOf(stale);
                if (idx !== -1) {
                    this.accessories.splice(idx, 1);
                }
            }
        }
    }
}
exports.Pulse8AppleTvCecPlatform = Pulse8AppleTvCecPlatform;
//# sourceMappingURL=platform.js.map