"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pulse8AppleTvCecPlatform = void 0;
exports.normalizePlatformConfig = normalizePlatformConfig;
exports.matchesAppleTvFilter = matchesAppleTvFilter;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_1 = require("./settings");
const cecClient_1 = require("./cecClient");
const platformAccessory_1 = require("./platformAccessory");
const targetDiscovery_1 = require("./targetDiscovery");
const targetDriver_1 = require("./targetDriver");
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
function normalizePlatformConfig(config) {
    const rawMode = config.targetMode;
    let targetMode = 'auto';
    if (rawMode === 'trinnov' ||
        rawMode === 'tcp' ||
        rawMode === 'http' ||
        rawMode === 'disabled') {
        targetMode = rawMode;
    }
    else {
        const legacyMode = config.trinnovControl;
        if (legacyMode === 'enabled') {
            targetMode = 'trinnov';
        }
        else if (legacyMode === 'disabled') {
            targetMode = 'disabled';
        }
        else {
            targetMode = 'auto';
        }
    }
    const rawMute = (config.targetMuteAction ?? config.trinnovMuteAction);
    const targetMuteAction = rawMute === 'ignore' ? 'ignore' : 'toggle';
    const rawPowerMode = config.targetPowerMode;
    const targetPowerMode = rawPowerMode === 'none' || rawPowerMode === 'all' ? rawPowerMode : 'keysOnly';
    const rawSensor = config.powerSensorType;
    const powerSensorType = rawSensor === 'occupancy' || rawSensor === 'switch' ? rawSensor : 'none';
    const powerKeyMode = config.powerKeyMode === 'handle' ? 'handle' : 'ignore';
    const targetAutodetectPlugins = Array.isArray(config.targetAutodetectPlugins)
        ? config.targetAutodetectPlugins.filter((v) => typeof v === 'string' && v.trim().length > 0)
        : undefined;
    return {
        targetMode,
        targetHost: (config.targetHost ?? config.trinnovHost),
        targetPort: (config.targetPort ?? config.trinnovPort),
        targetVolumeStepDb: (config.targetVolumeStepDb ?? config.trinnovVolumeStepDb),
        targetMuteAction,
        targetPowerMode,
        targetDiscoveryUrl: (config.targetDiscoveryUrl ?? config.trinnovDiscoveryUrl),
        targetClientId: (config.targetClientId ?? config.trinnovClientId),
        targetIdleTimeoutMs: (config.targetIdleTimeoutMs ?? config.trinnovIdleTimeoutMs),
        targetAutodetectPlugins,
        tcpCommands: config.tcpCommands,
        httpEndpoints: config.httpEndpoints,
        powerSensorType,
        includePowerButtons: config.includePowerButtons === true,
        powerDebounceMs: config.powerDebounceMs,
        ignoreStandbyAfterWakeMs: config.ignoreStandbyAfterWakeMs,
        powerKeyMode,
    };
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
    targetResolver = null;
    driverPool = null;
    normalizedConfig;
    registeredPlatformName = settings_1.PLATFORM_NAME;
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.normalizedConfig = normalizePlatformConfig(this.config);
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
            if (this.targetResolver) {
                this.targetResolver.stop();
                this.targetResolver = null;
            }
            if (this.driverPool) {
                this.driverPool.stopAll();
                this.driverPool = null;
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
    createAccessoryHandler(accessory, device, displayName) {
        return new platformAccessory_1.Pulse8AppleTvAccessory(this, accessory, device, displayName, this.pluginVersion, {
            powerSensorType: this.normalizedConfig.powerSensorType,
            includePowerButtons: this.normalizedConfig.includePowerButtons,
            initialPowerState: this.cecClient?.getBusPowerState(device.logicalAddress) ?? null,
            onPowerSwitchSet: (powered) => {
                if (this.normalizedConfig.targetPowerMode !== 'none') {
                    this.dispatchTargetAction(device.logicalAddress, powered ? 'powerOn' : 'powerOff', false);
                }
            },
        });
    }
    startCecBridge() {
        const cfg = this.normalizedConfig;
        const resolver = new targetDiscovery_1.TargetResolver({
            mode: cfg.targetMode,
            host: cfg.targetHost,
            port: cfg.targetPort,
            volumeStepDb: cfg.targetVolumeStepDb,
            discoveryUrl: cfg.targetDiscoveryUrl,
            storagePath: this.api.user.storagePath(),
            configPath: this.api.user.configPath(),
            autodetectPlugins: cfg.targetAutodetectPlugins,
            tcpCommands: cfg.tcpCommands,
            httpEndpoints: cfg.httpEndpoints,
        }, this.log);
        resolver.start();
        this.targetResolver = resolver;
        const initialCandidates = resolver.getCandidateList();
        if (cfg.targetHost) {
            this.log.info(`[Target] Configured direct target (${cfg.targetMode}): ${cfg.targetHost}${cfg.targetPort ? `:${cfg.targetPort}` : ''}`);
        }
        else if (initialCandidates.length > 0) {
            const summary = initialCandidates
                .map((c) => `${c.name || c.id || c.driver} [${c.driver}] (${c.host}:${c.port} via ${c.source})`)
                .join(', ');
            this.log.info(`[Target] Auto-discovered target(s): ${summary}`);
        }
        else if (cfg.targetMode !== 'disabled') {
            this.log.info('[Target] No external target discovered yet; watching Homebridge storagePath/config for discovery files (HomeKit buttons remain active).');
        }
        this.driverPool = new targetDriver_1.TargetDriverPool({
            clientId: cfg.targetClientId,
            idleTimeoutMs: cfg.targetIdleTimeoutMs,
            tcpCommands: cfg.tcpCommands,
            httpEndpoints: cfg.httpEndpoints,
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
                const handler = this.createAccessoryHandler(cached, placeholderDevice, cached.displayName);
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
            powerDebounceMs: cfg.powerDebounceMs,
            ignoreStandbyAfterWakeMs: cfg.ignoreStandbyAfterWakeMs,
            powerKeyMode: cfg.powerKeyMode,
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
        client.on('powerChange', (event) => {
            const entry = this.findEntryForLogicalAddress(event.logicalAddress);
            if (entry) {
                entry.handler.setPowerState(event.powered);
                if (this.normalizedConfig.includePowerButtons && event.source === 'bus') {
                    entry.handler.triggerKeyEvent(event.powered ? 'powerOn' : 'powerOff', 'single');
                }
            }
        });
        client.on('action', (event) => {
            this.handleSemanticAction(event);
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
    handleSemanticAction(event) {
        const cfg = this.normalizedConfig;
        if (event.action === 'muteToggle' && cfg.targetMuteAction === 'ignore') {
            return;
        }
        if (event.action === 'powerOn' ||
            event.action === 'powerOff' ||
            event.action === 'powerToggle') {
            if (cfg.targetPowerMode === 'none') {
                return;
            }
            if (cfg.targetPowerMode === 'keysOnly' && event.source !== 'key') {
                return;
            }
        }
        this.dispatchTargetAction(event.logicalAddress, event.action, event.isRepeat);
    }
    dispatchTargetAction(logicalAddress, action, isRepeat) {
        if (!this.targetResolver || !this.driverPool) {
            return;
        }
        const entry = this.findEntryForLogicalAddress(logicalAddress);
        const resolved = this.targetResolver.resolveForAppleTv({
            displayName: entry?.displayName || 'Apple TV',
            osdString: entry?.osdString || 'Apple TV',
            deviceOverride: entry?.override,
        });
        if (!resolved) {
            return;
        }
        this.driverPool.sendAction(resolved.target, action, {
            stepDb: resolved.stepDb,
            isRepeat,
            sourceName: entry?.displayName || entry?.osdString || 'Apple TV',
            logicalAddress,
        });
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
                const handler = this.createAccessoryHandler(existingAccessory, device, displayName);
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
                const handler = this.createAccessoryHandler(accessory, device, displayName);
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