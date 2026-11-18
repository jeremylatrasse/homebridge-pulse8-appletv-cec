"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TargetResolver = exports.TRINNOV_DISCOVERY_FILENAME = exports.GENERIC_DISCOVERY_FILENAME = void 0;
exports.parseDiscoveryPayload = parseDiscoveryPayload;
exports.extractTargetsFromHomebridgeConfig = extractTargetsFromHomebridgeConfig;
const node_fs_1 = require("node:fs");
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const node_path_1 = require("node:path");
const targetDriver_1 = require("./targetDriver");
exports.GENERIC_DISCOVERY_FILENAME = 'homebridge-cec-targets.json';
exports.TRINNOV_DISCOVERY_FILENAME = 'homebridge-trinnov-discovery.json';
const GENERIC_AV_PLUGIN_KEYWORDS = [
    'avr',
    'receiver',
    'amplifier',
    'preamp',
    'processor',
    'soundbar',
    'sonos',
    'onkyo',
    'integra',
    'arcam',
    'emotiva',
    'nad',
    'rotel',
    'mcintosh',
    'lexicon',
    'datasat',
    'synthesis',
    'webos',
    'bravia',
    'tizen',
    'vizio',
    'roku',
    'bose',
];
function normalizeHost(entry) {
    for (const candidate of [
        entry.host,
        entry.ip,
        entry.ipAddress,
        entry.address,
        entry.server,
    ]) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed.length > 0) {
                return trimmed;
            }
        }
    }
    if (typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url.trim())) {
        try {
            const parsed = new URL(entry.url.trim());
            if (parsed.hostname) {
                return parsed.hostname;
            }
        }
        catch {
            // Ignore invalid URL
        }
    }
    return null;
}
function normalizeStepDb(rawStep) {
    if (typeof rawStep === 'number' && Number.isFinite(rawStep) && rawStep > 0 && rawStep <= 10) {
        return rawStep;
    }
    return undefined;
}
function normalizeString(val) {
    if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
}
function normalizeDriverType(rawDriver) {
    if (typeof rawDriver !== 'string') {
        return undefined;
    }
    const lower = rawDriver.trim().toLowerCase();
    if (lower === 'trinnov' || lower === 'tcp' || lower === 'http') {
        return lower;
    }
    return undefined;
}
function inferDriverType(params) {
    const explicit = normalizeDriverType(params.explicitDriver);
    if (explicit) {
        return explicit;
    }
    const pluginLower = params.plugin?.toLowerCase() ?? '';
    if (pluginLower.includes('trinnov')) {
        return 'trinnov';
    }
    if (params.httpEndpoints && !params.tcpCommands) {
        return 'http';
    }
    const numericPort = (0, targetDriver_1.normalizePort)(params.port, 0);
    if (numericPort === targetDriver_1.TRINNOV_DEFAULT_PORT) {
        return 'trinnov';
    }
    if (params.tcpCommands) {
        return 'tcp';
    }
    if (params.httpEndpoint && numericPort === 0) {
        return 'http';
    }
    return numericPort === 0 ? 'trinnov' : 'tcp';
}
function hasAnyHttpEndpoint(endpoints) {
    if (!endpoints) {
        return false;
    }
    return Boolean(endpoints.volumeUp ||
        endpoints.volumeDown ||
        endpoints.mute ||
        endpoints.powerOn ||
        endpoints.powerOff ||
        endpoints.powerToggle);
}
function hasAnyTcpCommand(commands) {
    if (!commands) {
        return false;
    }
    return Boolean(commands.volumeUp ||
        commands.volumeDown ||
        commands.mute ||
        commands.powerOn ||
        commands.powerOff ||
        commands.powerToggle);
}
function hasActionableCommands(target) {
    if (target.driver === 'trinnov') {
        return true;
    }
    if (target.driver === 'http') {
        return hasAnyHttpEndpoint(target.httpEndpoints);
    }
    return hasAnyTcpCommand(target.tcpCommands);
}
function parseDiscoveryPayload(raw, source) {
    if (!raw || typeof raw !== 'object') {
        return { targets: [] };
    }
    const payload = raw;
    const plugin = normalizeString(payload.plugin);
    const targets = [];
    const entries = Array.isArray(payload.targets)
        ? payload.targets
        : Array.isArray(payload.processors)
            ? payload.processors
            : null;
    if (entries) {
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || entry.enabled === false) {
                continue;
            }
            const host = normalizeHost(entry);
            if (!host) {
                continue;
            }
            const httpEndpoint = normalizeString(entry.httpEndpoint);
            const driver = inferDriverType({
                explicitDriver: entry.driver,
                plugin,
                port: entry.port,
                httpEndpoint,
                httpEndpoints: entry.httpEndpoints,
                tcpCommands: entry.tcpCommands,
            });
            const defaultPort = driver === 'http' ? 80 : driver === 'trinnov' ? targetDriver_1.TRINNOV_DEFAULT_PORT : 23;
            targets.push({
                id: normalizeString(entry.id),
                name: normalizeString(entry.name),
                plugin,
                driver,
                host,
                port: (0, targetDriver_1.normalizePort)(entry.port, defaultPort),
                powered: typeof entry.powered === 'boolean' ? entry.powered : undefined,
                activeSource: normalizeString(entry.activeSource),
                volumeStepDb: normalizeStepDb(entry.volumeStepDb),
                httpEndpoint,
                tcpCommands: entry.tcpCommands,
                httpEndpoints: entry.httpEndpoints,
                source,
            });
        }
    }
    else {
        const host = normalizeHost(payload);
        if (host) {
            const httpEndpoint = normalizeString(payload.httpEndpoint);
            const driver = inferDriverType({
                explicitDriver: payload.driver,
                plugin,
                port: payload.port,
                httpEndpoint,
            });
            const defaultPort = driver === 'http' ? 80 : driver === 'trinnov' ? targetDriver_1.TRINNOV_DEFAULT_PORT : 23;
            targets.push({
                id: normalizeString(payload.id),
                name: normalizeString(payload.name),
                plugin,
                driver,
                host,
                port: (0, targetDriver_1.normalizePort)(payload.port, defaultPort),
                powered: typeof payload.powered === 'boolean' ? payload.powered : undefined,
                activeSource: normalizeString(payload.activeSource),
                volumeStepDb: normalizeStepDb(payload.volumeStepDb),
                httpEndpoint,
                source,
            });
        }
    }
    let httpTargetsUrl;
    if (payload.http && typeof payload.http.baseUrl === 'string' && payload.http.baseUrl.trim()) {
        const base = payload.http.baseUrl.trim().replace(/\/+$/, '');
        const path = typeof payload.http.targetsPath === 'string' && payload.http.targetsPath.trim()
            ? payload.http.targetsPath.trim()
            : '/api/cec/targets';
        httpTargetsUrl = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return { targets, httpTargetsUrl };
}
function extractTargetsFromConfigObject(entry, defaults, targets, seenKeys) {
    if (entry.enabled === false) {
        return;
    }
    const pushEntry = (item, fallbackName) => {
        if (item.enabled === false) {
            return;
        }
        const cecMeta = item.cecTarget && typeof item.cecTarget === 'object'
            ? item.cecTarget
            : undefined;
        const itemTcp = cecMeta?.tcpCommands ??
            item.tcpCommands ??
            defaults.tcpCommands;
        const itemHttp = cecMeta?.httpEndpoints ??
            item.httpEndpoints ??
            defaults.httpEndpoints;
        const itemHint = [
            normalizeString(item.name),
            normalizeString(item.model),
            normalizeString(item.brand),
            normalizeString(item.type),
        ]
            .filter(Boolean)
            .join(' ');
        const itemPreset = itemHint ? (0, targetDriver_1.matchBuiltInTargetPreset)(itemHint) : null;
        const effectiveDriver = normalizeDriverType(cecMeta?.driver ?? item.driver) ??
            itemPreset?.driver ??
            defaults.driver;
        const effectiveDefaultPort = itemPreset?.defaultPort ??
            (effectiveDriver === 'http'
                ? 80
                : effectiveDriver === 'trinnov'
                    ? targetDriver_1.TRINNOV_DEFAULT_PORT
                    : defaults.defaultPort);
        const host = normalizeHost(item);
        const urlStr = normalizeString(item.url);
        if (!host && !(effectiveDriver === 'http' && hasAnyHttpEndpoint(itemHttp))) {
            return;
        }
        const effectiveHost = host || 'webhook';
        const port = (0, targetDriver_1.normalizePort)(cecMeta?.port ?? item.port, effectiveDefaultPort);
        const key = `${effectiveDriver}:${effectiveHost.toLowerCase()}:${port}`;
        if (seenKeys.has(key)) {
            return;
        }
        seenKeys.add(key);
        let httpEndpoint;
        if (effectiveDriver === 'http' && urlStr && /^https?:\/\//i.test(urlStr)) {
            try {
                const parsed = new URL(urlStr);
                httpEndpoint = `${parsed.protocol}//${parsed.host}`;
            }
            catch {
                // Ignore invalid URL
            }
        }
        targets.push({
            id: normalizeString(cecMeta?.id ?? item.id),
            name: normalizeString(item.name) || fallbackName,
            plugin: defaults.pluginHint,
            driver: effectiveDriver,
            host: effectiveHost,
            port,
            volumeStepDb: normalizeStepDb(cecMeta?.volumeStepDb ?? item.volumeStepDb),
            httpEndpoint,
            tcpCommands: itemPreset?.tcpCommands ?? itemTcp,
            httpEndpoints: itemPreset?.httpEndpoints ?? itemHttp,
            source: 'homebridgeConfig',
        });
    };
    pushEntry(entry);
    for (const arrayKey of [
        'devices',
        'processors',
        'amplifiers',
        'receivers',
        'zones',
        'targets',
        'speakers',
        'tvs',
    ]) {
        const nested = entry[arrayKey];
        if (Array.isArray(nested)) {
            for (const item of nested) {
                if (item && typeof item === 'object') {
                    pushEntry(item, normalizeString(entry.name));
                }
            }
        }
    }
}
function extractTargetsFromHomebridgeConfig(rawConfig, options = {}) {
    if (!rawConfig || typeof rawConfig !== 'object') {
        return [];
    }
    const config = rawConfig;
    const targets = [];
    const seenKeys = new Set();
    const extraMatchers = (options.autodetectPlugins ?? [])
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);
    const inspectEntry = (rawEntry, kind) => {
        if (!rawEntry || typeof rawEntry !== 'object') {
            return;
        }
        const entry = rawEntry;
        const identifier = kind === 'platform'
            ? normalizeString(entry.platform) || ''
            : normalizeString(entry.accessory) || '';
        const identifierLower = identifier.toLowerCase();
        // Never autodetect ourselves as a target
        if (identifierLower === 'pulse8appletvcec' ||
            identifierLower.includes('homebridge-pulse8-appletv-cec')) {
            return;
        }
        const name = normalizeString(entry.name) || '';
        const hint = `${identifier} ${name}`.trim().toLowerCase();
        const hasExplicitCecTarget = entry.cecTarget === true ||
            Boolean(entry.cecTarget && typeof entry.cecTarget === 'object') ||
            Boolean(entry.tcpCommands) ||
            Boolean(entry.httpEndpoints);
        const preset = (0, targetDriver_1.matchBuiltInTargetPreset)(hint);
        const matchesGenericKeyword = GENERIC_AV_PLUGIN_KEYWORDS.some((kw) => hint.includes(kw));
        const matchesUserPlugin = extraMatchers.some((kw) => hint.includes(kw));
        if (!preset && !hasExplicitCecTarget && !matchesGenericKeyword && !matchesUserPlugin) {
            return;
        }
        const cecMeta = entry.cecTarget && typeof entry.cecTarget === 'object'
            ? entry.cecTarget
            : undefined;
        const explicitDriver = normalizeDriverType(cecMeta?.driver ?? entry.driver);
        const driver = explicitDriver ??
            preset?.driver ??
            (entry.httpEndpoints && !entry.tcpCommands ? 'http' : 'tcp');
        const defaultPort = preset?.defaultPort ??
            (driver === 'http' ? 80 : driver === 'trinnov' ? targetDriver_1.TRINNOV_DEFAULT_PORT : 23);
        extractTargetsFromConfigObject(entry, {
            driver,
            defaultPort,
            pluginHint: identifier || name || 'homebridge-config',
            tcpCommands: cecMeta?.tcpCommands ??
                entry.tcpCommands ??
                preset?.tcpCommands,
            httpEndpoints: cecMeta?.httpEndpoints ??
                entry.httpEndpoints ??
                preset?.httpEndpoints,
        }, targets, seenKeys);
    };
    if (Array.isArray(config.platforms)) {
        for (const platform of config.platforms) {
            inspectEntry(platform, 'platform');
        }
    }
    if (Array.isArray(config.accessories)) {
        for (const accessory of config.accessories) {
            inspectEntry(accessory, 'accessory');
        }
    }
    return targets;
}
function defaultHttpFetch(urlString, timeoutMs) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(urlString);
        }
        catch (err) {
            reject(err);
            return;
        }
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.get(parsed, { timeout: timeoutMs }, (res) => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`));
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('timeout', () => {
            req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
    });
}
class TargetResolver {
    log;
    mode;
    platformHost;
    platformPort;
    defaultStepDb;
    configuredDiscoveryUrl;
    storagePath;
    configPath;
    autodetectPlugins;
    platformTcpCommands;
    platformHttpEndpoints;
    httpFetcher;
    fileTargets = [];
    httpTargets = [];
    configTargets = [];
    discoveredHttpUrl;
    lastDiskCheckAt = 0;
    lastFileMtimes = new Map();
    lastHttpFetchAt = 0;
    httpFetchInFlight = false;
    refreshTimer = null;
    lastLoggedTargetKey = null;
    constructor(options, log) {
        this.log = log;
        this.mode = options.mode ?? 'auto';
        this.platformHost = normalizeString(options.host);
        this.platformPort =
            typeof options.port === 'number' && options.port >= 1 && options.port <= 65535
                ? Math.floor(options.port)
                : undefined;
        this.defaultStepDb = normalizeStepDb(options.volumeStepDb) ?? 1;
        this.configuredDiscoveryUrl = normalizeString(options.discoveryUrl);
        this.storagePath = normalizeString(options.storagePath);
        this.configPath = normalizeString(options.configPath);
        this.autodetectPlugins = options.autodetectPlugins;
        this.platformTcpCommands = options.tcpCommands;
        this.platformHttpEndpoints = options.httpEndpoints;
        this.httpFetcher = options.httpFetcher ?? defaultHttpFetch;
    }
    start() {
        if (this.mode === 'disabled') {
            this.log.info('[Target] Direct target control is disabled (HomeKit-only mode).');
            return;
        }
        this.refreshSync();
        void this.refreshHttp();
        if (!this.refreshTimer) {
            this.refreshTimer = setInterval(() => {
                this.refreshSync();
                void this.refreshHttp();
            }, 15000);
            this.refreshTimer.unref();
        }
    }
    stop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    refreshSync() {
        this.lastDiskCheckAt = Date.now();
        this.loadDiscoveryFiles();
        this.loadHomebridgeConfig();
    }
    async refreshHttp() {
        if (this.mode === 'disabled' || this.httpFetchInFlight) {
            return;
        }
        const url = this.configuredDiscoveryUrl || this.discoveredHttpUrl;
        if (!url) {
            return;
        }
        this.httpFetchInFlight = true;
        this.lastHttpFetchAt = Date.now();
        try {
            const body = await this.httpFetcher(url, 1200);
            const parsed = JSON.parse(body);
            const { targets } = parseDiscoveryPayload(parsed, 'discoveryHttp');
            if (targets.length > 0) {
                this.httpTargets = targets;
                this.log.debug(`[Target] HTTP discovery (${url}) returned ${targets.length} target(s).`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.debug(`[Target] HTTP discovery poll (${url}) unavailable: ${msg}`);
        }
        finally {
            this.httpFetchInFlight = false;
        }
    }
    resolveForAppleTv(params) {
        const override = params.deviceOverride;
        const isDeviceDisabled = override?.targetEnabled === false || override?.trinnovEnabled === false;
        if (this.mode === 'disabled' || isDeviceDisabled) {
            return null;
        }
        const stepDb = normalizeStepDb(override?.volumeStepDb) ?? this.defaultStepDb;
        // 1. Per-Apple TV explicit host / endpoints override
        const overrideHost = normalizeString(override?.targetHost) ?? normalizeString(override?.trinnovHost);
        const overridePort = override?.targetPort ?? override?.trinnovPort;
        if (overrideHost || hasAnyHttpEndpoint(override?.httpEndpoints)) {
            const driver = this.resolveExplicitDriver(override?.targetDriver, override?.tcpCommands, override?.httpEndpoints);
            const defaultPort = this.defaultPortForDriver(driver);
            const target = {
                id: normalizeString(override?.targetId) ?? normalizeString(override?.trinnovId),
                name: params.displayName,
                driver,
                host: overrideHost || 'webhook',
                port: (0, targetDriver_1.normalizePort)(overridePort, defaultPort),
                volumeStepDb: stepDb,
                tcpCommands: this.platformTcpCommands || override?.tcpCommands
                    ? { ...this.platformTcpCommands, ...override?.tcpCommands }
                    : undefined,
                httpEndpoints: this.platformHttpEndpoints || override?.httpEndpoints
                    ? { ...this.platformHttpEndpoints, ...override?.httpEndpoints }
                    : undefined,
                source: 'deviceConfig',
            };
            this.logResolvedOnce(target);
            return { target, stepDb };
        }
        // Refresh disk discovery lightly if stale (> 2s)
        const now = Date.now();
        if (now - this.lastDiskCheckAt > 2000) {
            this.maybeReloadDiscoveryFiles();
        }
        if (now - this.lastHttpFetchAt > 10000) {
            void this.refreshHttp();
        }
        const candidates = this.filterCandidatesByMode(this.getCandidateList());
        // 2. Per-Apple TV targetId / trinnovId matched against discovered targets
        const requestedId = (normalizeString(override?.targetId) ?? normalizeString(override?.trinnovId))?.toLowerCase();
        if (requestedId) {
            const matched = candidates.find((c) => c.id?.toLowerCase() === requestedId ||
                c.name?.toLowerCase() === requestedId);
            if (matched) {
                const effectiveStep = normalizeStepDb(override?.volumeStepDb) ??
                    matched.volumeStepDb ??
                    this.defaultStepDb;
                const enriched = this.applyOverrideCommands(matched, override);
                this.logResolvedOnce(enriched);
                return { target: enriched, stepDb: effectiveStep };
            }
        }
        // 3. Platform-level explicit host or HTTP endpoints override
        if (this.platformHost || (this.mode === 'http' && hasAnyHttpEndpoint(this.platformHttpEndpoints))) {
            const driver = this.resolveExplicitDriver(undefined, this.platformTcpCommands, this.platformHttpEndpoints);
            const defaultPort = this.defaultPortForDriver(driver);
            const target = {
                driver,
                host: this.platformHost || 'webhook',
                port: (0, targetDriver_1.normalizePort)(this.platformPort, defaultPort),
                volumeStepDb: stepDb,
                tcpCommands: this.platformTcpCommands,
                httpEndpoints: this.platformHttpEndpoints,
                source: 'platformConfig',
            };
            this.logResolvedOnce(target);
            return { target, stepDb };
        }
        // 4. Auto-discovered target (HTTP discovery -> discovery files -> Homebridge config.json)
        if (candidates.length === 0) {
            if (this.mode !== 'auto') {
                this.log.warn(`[Target] Target mode "${this.mode}" is active, but no compatible target was configured or discovered yet.`);
            }
            return null;
        }
        const selected = this.selectBestCandidate(candidates, params.displayName, params.osdString);
        const effectiveStep = normalizeStepDb(override?.volumeStepDb) ??
            selected.volumeStepDb ??
            this.defaultStepDb;
        const enriched = this.applyOverrideCommands(selected, override);
        this.logResolvedOnce(enriched);
        return { target: enriched, stepDb: effectiveStep };
    }
    getCandidateList() {
        if (this.httpTargets.length > 0) {
            return this.httpTargets;
        }
        if (this.fileTargets.length > 0) {
            return this.fileTargets;
        }
        return this.configTargets;
    }
    filterCandidatesByMode(candidates) {
        if (this.mode === 'auto') {
            return candidates;
        }
        return candidates.filter((c) => c.driver === this.mode);
    }
    resolveExplicitDriver(overrideDriver, tcpCommands, httpEndpoints) {
        if (overrideDriver) {
            return overrideDriver;
        }
        if (this.mode === 'tcp' || this.mode === 'http' || this.mode === 'trinnov') {
            return this.mode;
        }
        if (hasAnyHttpEndpoint(httpEndpoints ?? this.platformHttpEndpoints)) {
            return 'http';
        }
        if (hasAnyTcpCommand(tcpCommands ?? this.platformTcpCommands)) {
            return 'tcp';
        }
        return 'trinnov';
    }
    defaultPortForDriver(driver) {
        if (this.platformPort !== undefined) {
            return this.platformPort;
        }
        if (driver === 'trinnov') {
            return targetDriver_1.TRINNOV_DEFAULT_PORT;
        }
        if (driver === 'http') {
            return 80;
        }
        return 23;
    }
    applyOverrideCommands(base, override) {
        const mergedTcp = base.tcpCommands || this.platformTcpCommands || override?.tcpCommands
            ? { ...base.tcpCommands, ...this.platformTcpCommands, ...override?.tcpCommands }
            : undefined;
        const mergedHttp = base.httpEndpoints || this.platformHttpEndpoints || override?.httpEndpoints
            ? { ...base.httpEndpoints, ...this.platformHttpEndpoints, ...override?.httpEndpoints }
            : undefined;
        if (!mergedTcp && !mergedHttp && !override?.targetDriver) {
            return base;
        }
        return {
            ...base,
            driver: override?.targetDriver ?? base.driver,
            tcpCommands: mergedTcp,
            httpEndpoints: mergedHttp,
        };
    }
    selectBestCandidate(candidates, displayName, osdString) {
        if (candidates.length === 1) {
            return candidates[0];
        }
        const appleTvNames = [displayName, osdString]
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0);
        // Prefer target whose activeSource matches this Apple TV's name
        for (const candidate of candidates) {
            const activeSrc = candidate.activeSource?.toLowerCase();
            if (!activeSrc) {
                continue;
            }
            if (appleTvNames.some((n) => activeSrc === n || activeSrc.includes(n) || n.includes(activeSrc))) {
                return candidate;
            }
        }
        // Prefer powered-on target
        const powered = candidates.find((c) => c.powered === true);
        if (powered) {
            return powered;
        }
        // Prefer targets that already have actionable commands/presets over generic commandless entries
        const actionable = candidates.find((c) => hasActionableCommands(c));
        if (actionable) {
            return actionable;
        }
        return candidates[0];
    }
    logResolvedOnce(target) {
        const key = `${target.driver}:${target.source}:${target.host}:${target.port}:${target.id || ''}`;
        if (this.lastLoggedTargetKey !== key) {
            this.lastLoggedTargetKey = key;
            this.log.info(`[Target] Routing CEC actions to [${target.driver}] ${target.host}:${target.port}` +
                `${target.name ? ` (${target.name})` : ''} via ${target.source}`);
        }
    }
    getDiscoveryFilePaths() {
        if (!this.storagePath) {
            return [];
        }
        const paths = [];
        const genericPath = (0, node_path_1.join)(this.storagePath, exports.GENERIC_DISCOVERY_FILENAME);
        if ((0, node_fs_1.existsSync)(genericPath)) {
            paths.push(genericPath);
        }
        try {
            const entries = (0, node_fs_1.readdirSync)(this.storagePath)
                .filter((name) => /^homebridge-.*-discovery\.json$/i.test(name))
                .sort();
            for (const name of entries) {
                const fullPath = (0, node_path_1.join)(this.storagePath, name);
                if (!paths.includes(fullPath)) {
                    paths.push(fullPath);
                }
            }
        }
        catch {
            // Ignore unreadable storagePath
        }
        return paths;
    }
    maybeReloadDiscoveryFiles() {
        this.lastDiskCheckAt = Date.now();
        if (!this.storagePath) {
            return;
        }
        const currentPaths = this.getDiscoveryFilePaths();
        let changed = currentPaths.length !== this.lastFileMtimes.size;
        if (!changed) {
            for (const filePath of currentPaths) {
                try {
                    const st = (0, node_fs_1.statSync)(filePath);
                    if (this.lastFileMtimes.get(filePath) !== st.mtimeMs) {
                        changed = true;
                        break;
                    }
                }
                catch {
                    changed = true;
                    break;
                }
            }
        }
        if (changed) {
            this.loadDiscoveryFiles();
        }
    }
    loadDiscoveryFiles() {
        if (!this.storagePath) {
            return;
        }
        const paths = this.getDiscoveryFilePaths();
        const nextMtimes = new Map();
        const combinedTargets = [];
        const seenKeys = new Set();
        let firstHttpUrl;
        for (const filePath of paths) {
            try {
                const st = (0, node_fs_1.statSync)(filePath);
                if (!st.isFile()) {
                    continue;
                }
                nextMtimes.set(filePath, st.mtimeMs);
                const content = (0, node_fs_1.readFileSync)(filePath, 'utf8');
                const parsed = JSON.parse(content);
                const { targets, httpTargetsUrl } = parseDiscoveryPayload(parsed, 'discoveryFile');
                if (!firstHttpUrl && httpTargetsUrl) {
                    firstHttpUrl = httpTargetsUrl;
                }
                for (const target of targets) {
                    const dedupKey = `${target.driver}:${target.host.toLowerCase()}:${target.port}:${target.id || ''}`;
                    if (!seenKeys.has(dedupKey)) {
                        seenKeys.add(dedupKey);
                        combinedTargets.push(target);
                    }
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.log.debug(`[Target] Failed to read ${filePath}: ${msg}`);
            }
        }
        this.lastFileMtimes = nextMtimes;
        this.fileTargets = combinedTargets;
        this.discoveredHttpUrl = firstHttpUrl;
    }
    loadHomebridgeConfig() {
        if (!this.configPath) {
            return;
        }
        try {
            if (!(0, node_fs_1.existsSync)(this.configPath)) {
                return;
            }
            const content = (0, node_fs_1.readFileSync)(this.configPath, 'utf8');
            const parsed = JSON.parse(content);
            this.configTargets = extractTargetsFromHomebridgeConfig(parsed, {
                autodetectPlugins: this.autodetectPlugins,
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.debug(`[Target] Failed to read Homebridge config ${this.configPath}: ${msg}`);
        }
    }
}
exports.TargetResolver = TargetResolver;
//# sourceMappingURL=targetDiscovery.js.map