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
exports.TrinnovClientPool = exports.TrinnovTcpClient = exports.TrinnovTargetResolver = exports.TRINNOV_DISCOVERY_FILENAME = exports.TRINNOV_DEFAULT_PORT = void 0;
exports.parseTrinnovDiscoveryPayload = parseTrinnovDiscoveryPayload;
exports.extractTrinnovTargetsFromHomebridgeConfig = extractTrinnovTargetsFromHomebridgeConfig;
const node_fs_1 = require("node:fs");
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const net = __importStar(require("node:net"));
const node_path_1 = require("node:path");
exports.TRINNOV_DEFAULT_PORT = 44100;
exports.TRINNOV_DISCOVERY_FILENAME = 'homebridge-trinnov-discovery.json';
function normalizeHost(entry) {
    for (const candidate of [entry.host, entry.ip, entry.ipAddress, entry.address]) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed.length > 0) {
                return trimmed;
            }
        }
    }
    return null;
}
function normalizePort(rawPort, fallback = exports.TRINNOV_DEFAULT_PORT) {
    if (typeof rawPort === 'number' && Number.isFinite(rawPort)) {
        const p = Math.floor(rawPort);
        if (p >= 1 && p <= 65535) {
            return p;
        }
    }
    if (typeof rawPort === 'string' && /^\d+$/.test(rawPort.trim())) {
        const p = parseInt(rawPort.trim(), 10);
        if (p >= 1 && p <= 65535) {
            return p;
        }
    }
    return fallback;
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
function parseTrinnovDiscoveryPayload(raw, source) {
    if (!raw || typeof raw !== 'object') {
        return { targets: [] };
    }
    const payload = raw;
    const targets = [];
    if (Array.isArray(payload.processors)) {
        for (const entry of payload.processors) {
            if (!entry || typeof entry !== 'object' || entry.enabled === false) {
                continue;
            }
            const host = normalizeHost(entry);
            if (!host) {
                continue;
            }
            targets.push({
                id: normalizeString(entry.id),
                name: normalizeString(entry.name),
                host,
                port: normalizePort(entry.port),
                powered: typeof entry.powered === 'boolean' ? entry.powered : undefined,
                activeSource: normalizeString(entry.activeSource),
                volumeStepDb: normalizeStepDb(entry.volumeStepDb),
                httpEndpoint: normalizeString(entry.httpEndpoint),
                source,
            });
        }
    }
    else {
        const host = normalizeHost(payload);
        if (host) {
            targets.push({
                id: normalizeString(payload.id),
                name: normalizeString(payload.name),
                host,
                port: normalizePort(payload.port),
                powered: typeof payload.powered === 'boolean' ? payload.powered : undefined,
                activeSource: normalizeString(payload.activeSource),
                volumeStepDb: normalizeStepDb(payload.volumeStepDb),
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
function extractTargetsFromConfigObject(entry, targets, seenKeys) {
    if (entry.enabled === false) {
        return;
    }
    const pushEntry = (item, fallbackName) => {
        if (item.enabled === false) {
            return;
        }
        const host = normalizeHost(item);
        if (!host) {
            return;
        }
        const port = normalizePort(item.port);
        const key = `${host.toLowerCase()}:${port}`;
        if (seenKeys.has(key)) {
            return;
        }
        seenKeys.add(key);
        targets.push({
            id: normalizeString(item.id),
            name: normalizeString(item.name) || fallbackName,
            host,
            port,
            volumeStepDb: normalizeStepDb(item.volumeStepDb),
            source: 'homebridgeConfig',
        });
    };
    pushEntry(entry);
    for (const arrayKey of ['devices', 'processors', 'amplifiers', 'zones', 'targets']) {
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
function extractTrinnovTargetsFromHomebridgeConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
        return [];
    }
    const config = rawConfig;
    const targets = [];
    const seenKeys = new Set();
    if (Array.isArray(config.platforms)) {
        for (const platform of config.platforms) {
            if (!platform || typeof platform !== 'object') {
                continue;
            }
            const p = platform;
            const platformId = typeof p.platform === 'string' ? p.platform.toLowerCase() : '';
            const name = typeof p.name === 'string' ? p.name.toLowerCase() : '';
            if (platformId.includes('trinnov') || name.includes('trinnov')) {
                extractTargetsFromConfigObject(p, targets, seenKeys);
            }
        }
    }
    if (Array.isArray(config.accessories)) {
        for (const accessory of config.accessories) {
            if (!accessory || typeof accessory !== 'object') {
                continue;
            }
            const a = accessory;
            const accessoryId = typeof a.accessory === 'string' ? a.accessory.toLowerCase() : '';
            const name = typeof a.name === 'string' ? a.name.toLowerCase() : '';
            if (accessoryId.includes('trinnov') || name.includes('trinnov')) {
                extractTargetsFromConfigObject(a, targets, seenKeys);
            }
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
class TrinnovTargetResolver {
    log;
    mode;
    platformHost;
    platformPort;
    defaultStepDb;
    configuredDiscoveryUrl;
    discoveryFilePath;
    configPath;
    httpFetcher;
    fileTargets = [];
    httpTargets = [];
    configTargets = [];
    discoveredHttpUrl;
    lastDiskCheckAt = 0;
    lastDiscoveryFileMtimeMs = -1;
    lastHttpFetchAt = 0;
    httpFetchInFlight = false;
    refreshTimer = null;
    lastLoggedTargetKey = null;
    constructor(options, log) {
        this.log = log;
        this.mode = options.mode ?? 'auto';
        this.platformHost = normalizeString(options.host);
        this.platformPort = normalizePort(options.port);
        this.defaultStepDb = normalizeStepDb(options.volumeStepDb) ?? 1;
        this.configuredDiscoveryUrl = normalizeString(options.discoveryUrl);
        this.discoveryFilePath = options.storagePath
            ? (0, node_path_1.join)(options.storagePath, exports.TRINNOV_DISCOVERY_FILENAME)
            : undefined;
        this.configPath = normalizeString(options.configPath);
        this.httpFetcher = options.httpFetcher ?? defaultHttpFetch;
    }
    start() {
        if (this.mode === 'disabled') {
            this.log.info('[Trinnov] Direct Trinnov control is disabled.');
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
        this.loadDiscoveryFile();
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
            const { targets } = parseTrinnovDiscoveryPayload(parsed, 'discoveryHttp');
            if (targets.length > 0) {
                this.httpTargets = targets;
                this.log.debug(`[Trinnov] HTTP discovery (${url}) returned ${targets.length} processor(s).`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.debug(`[Trinnov] HTTP discovery poll (${url}) unavailable: ${msg}`);
        }
        finally {
            this.httpFetchInFlight = false;
        }
    }
    resolveForAppleTv(params) {
        if (this.mode === 'disabled' || params.deviceOverride?.trinnovEnabled === false) {
            return null;
        }
        const stepDb = normalizeStepDb(params.deviceOverride?.volumeStepDb) ?? this.defaultStepDb;
        // 1. Per-Apple TV explicit host override
        const overrideHost = normalizeString(params.deviceOverride?.trinnovHost);
        if (overrideHost) {
            const target = {
                id: normalizeString(params.deviceOverride?.trinnovId),
                name: params.displayName,
                host: overrideHost,
                port: normalizePort(params.deviceOverride?.trinnovPort, this.platformPort),
                volumeStepDb: stepDb,
                source: 'deviceConfig',
            };
            this.logResolvedOnce(target);
            return { target, stepDb };
        }
        // Refresh disk discovery lightly if stale (> 2s)
        const now = Date.now();
        if (now - this.lastDiskCheckAt > 2000) {
            this.maybeReloadDiscoveryFile();
        }
        if (now - this.lastHttpFetchAt > 10000) {
            void this.refreshHttp();
        }
        const candidates = this.getCandidateList();
        // 2. Per-Apple TV trinnovId matched against discovered processors
        const requestedId = normalizeString(params.deviceOverride?.trinnovId)?.toLowerCase();
        if (requestedId) {
            const matched = candidates.find((c) => c.id?.toLowerCase() === requestedId ||
                c.name?.toLowerCase() === requestedId);
            if (matched) {
                const effectiveStep = normalizeStepDb(params.deviceOverride?.volumeStepDb) ??
                    matched.volumeStepDb ??
                    this.defaultStepDb;
                this.logResolvedOnce(matched);
                return { target: matched, stepDb: effectiveStep };
            }
        }
        // 3. Platform-level explicit host override
        if (this.platformHost) {
            const target = {
                host: this.platformHost,
                port: this.platformPort,
                volumeStepDb: stepDb,
                source: 'platformConfig',
            };
            this.logResolvedOnce(target);
            return { target, stepDb };
        }
        // 4. Auto-discovered processor (HTTP discovery -> discovery file -> Homebridge config.json)
        if (candidates.length === 0) {
            if (this.mode === 'enabled') {
                this.log.warn('[Trinnov] Direct Trinnov control is enabled, but no Trinnov host was configured or discovered yet.');
            }
            return null;
        }
        const selected = this.selectBestCandidate(candidates, params.displayName, params.osdString);
        const effectiveStep = normalizeStepDb(params.deviceOverride?.volumeStepDb) ??
            selected.volumeStepDb ??
            this.defaultStepDb;
        this.logResolvedOnce(selected);
        return { target: selected, stepDb: effectiveStep };
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
    selectBestCandidate(candidates, displayName, osdString) {
        if (candidates.length === 1) {
            return candidates[0];
        }
        const appleTvNames = [displayName, osdString]
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0);
        // Prefer processor whose activeSource matches this Apple TV's name
        for (const candidate of candidates) {
            const activeSrc = candidate.activeSource?.toLowerCase();
            if (!activeSrc) {
                continue;
            }
            if (appleTvNames.some((n) => activeSrc === n || activeSrc.includes(n) || n.includes(activeSrc))) {
                return candidate;
            }
        }
        // Prefer powered-on processor
        const powered = candidates.find((c) => c.powered === true);
        if (powered) {
            return powered;
        }
        return candidates[0];
    }
    logResolvedOnce(target) {
        const key = `${target.source}:${target.host}:${target.port}:${target.id || ''}`;
        if (this.lastLoggedTargetKey !== key) {
            this.lastLoggedTargetKey = key;
            this.log.info(`[Trinnov] Routing CEC volume/mute to ${target.host}:${target.port}` +
                `${target.name ? ` (${target.name})` : ''} via ${target.source}`);
        }
    }
    maybeReloadDiscoveryFile() {
        this.lastDiskCheckAt = Date.now();
        if (!this.discoveryFilePath) {
            return;
        }
        try {
            if (!(0, node_fs_1.existsSync)(this.discoveryFilePath)) {
                if (this.lastDiscoveryFileMtimeMs !== -1) {
                    this.lastDiscoveryFileMtimeMs = -1;
                    this.fileTargets = [];
                    this.discoveredHttpUrl = undefined;
                }
                return;
            }
            const st = (0, node_fs_1.statSync)(this.discoveryFilePath);
            if (st.mtimeMs !== this.lastDiscoveryFileMtimeMs) {
                this.loadDiscoveryFile();
            }
        }
        catch {
            // Ignore transient stat failures
        }
    }
    loadDiscoveryFile() {
        if (!this.discoveryFilePath) {
            return;
        }
        try {
            if (!(0, node_fs_1.existsSync)(this.discoveryFilePath)) {
                this.fileTargets = [];
                this.discoveredHttpUrl = undefined;
                this.lastDiscoveryFileMtimeMs = -1;
                return;
            }
            const st = (0, node_fs_1.statSync)(this.discoveryFilePath);
            this.lastDiscoveryFileMtimeMs = st.mtimeMs;
            const content = (0, node_fs_1.readFileSync)(this.discoveryFilePath, 'utf8');
            const parsed = JSON.parse(content);
            const { targets, httpTargetsUrl } = parseTrinnovDiscoveryPayload(parsed, 'discoveryFile');
            this.fileTargets = targets;
            this.discoveredHttpUrl = httpTargetsUrl;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.debug(`[Trinnov] Failed to read ${this.discoveryFilePath}: ${msg}`);
        }
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
            this.configTargets = extractTrinnovTargetsFromHomebridgeConfig(parsed);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log.debug(`[Trinnov] Failed to read Homebridge config ${this.configPath}: ${msg}`);
        }
    }
}
exports.TrinnovTargetResolver = TrinnovTargetResolver;
class TrinnovTcpClient {
    log;
    host;
    port;
    clientId;
    idleTimeoutMs;
    connectTimeoutMs;
    socketFactory;
    socket = null;
    state = 'disconnected';
    isStopped = false;
    readBuffer = '';
    idSent = false;
    pendingCommands = [];
    connectTimer = null;
    welcomeFallbackTimer = null;
    handshakeTimer = null;
    idleTimer = null;
    lastWarnAt = 0;
    constructor(options, log) {
        this.log = log;
        this.host = options.host;
        this.port = normalizePort(options.port);
        this.clientId = (options.clientId?.trim() || 'homebridge-pulse8-appletv-cec').replace(/[\r\n]/g, ' ');
        this.idleTimeoutMs = options.idleTimeoutMs ?? 60000;
        this.connectTimeoutMs = options.connectTimeoutMs ?? 2000;
        this.socketFactory =
            options.socketFactory ?? ((port, host) => net.createConnection({ port, host }));
    }
    adjustVolume(deltaDb) {
        const formatted = Number(deltaDb.toFixed(2)).toString();
        this.sendCommand(`dvolume ${formatted}`);
    }
    toggleMute() {
        this.sendCommand('mute 2');
    }
    sendCommand(command) {
        if (this.isStopped) {
            return;
        }
        const sanitized = command.trim();
        if (!sanitized) {
            return;
        }
        this.resetIdleTimer();
        if (this.state === 'ready' && this.socket && !this.socket.destroyed && this.socket.writable) {
            this.writeLine(sanitized);
            return;
        }
        if (this.pendingCommands.length >= 12) {
            this.pendingCommands.shift();
        }
        this.pendingCommands.push(sanitized);
        if (this.state === 'disconnected') {
            this.connect();
        }
    }
    stop() {
        this.isStopped = true;
        this.pendingCommands = [];
        this.clearAllTimers();
        if (this.socket && !this.socket.destroyed) {
            const sock = this.socket;
            if (this.state === 'ready' && sock.writable) {
                try {
                    sock.end('bye\n');
                    const forceDestroy = setTimeout(() => {
                        if (!sock.destroyed) {
                            sock.destroy();
                        }
                    }, 150);
                    forceDestroy.unref();
                }
                catch {
                    sock.destroy();
                }
            }
            else {
                sock.destroy();
            }
        }
        this.socket = null;
        this.state = 'disconnected';
    }
    connect() {
        if (this.isStopped || this.state !== 'disconnected') {
            return;
        }
        this.state = 'connecting';
        this.idSent = false;
        this.readBuffer = '';
        const socket = this.socketFactory(this.port, this.host);
        this.socket = socket;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 15000);
        this.connectTimer = setTimeout(() => {
            this.handleFailure(`Connection to Trinnov ${this.host}:${this.port} timed out after ${this.connectTimeoutMs}ms`);
        }, this.connectTimeoutMs);
        socket.on('connect', () => {
            if (this.socket !== socket) {
                return;
            }
            this.clearConnectTimer();
            this.state = 'handshaking';
            // Wait briefly for the "Welcome on Trinnov..." banner; send `id` after 250ms if no banner arrives
            this.welcomeFallbackTimer = setTimeout(() => {
                this.sendHandshakeId();
            }, 250);
            this.handshakeTimer = setTimeout(() => {
                this.handleFailure(`Trinnov ${this.host}:${this.port} handshake timed out`);
            }, 2000);
        });
        socket.on('data', (chunk) => {
            if (this.socket !== socket) {
                return;
            }
            this.handleData(chunk.toString('utf8'));
        });
        socket.on('error', (err) => {
            if (this.socket !== socket) {
                return;
            }
            this.handleFailure(`Trinnov TCP error (${this.host}:${this.port}): ${err.message}`);
        });
        socket.on('close', () => {
            if (this.socket !== socket) {
                return;
            }
            this.cleanupSocket();
        });
    }
    handleData(text) {
        this.readBuffer += text;
        let newlineIdx = this.readBuffer.indexOf('\n');
        while (newlineIdx !== -1) {
            const line = this.readBuffer.slice(0, newlineIdx).replace(/\r$/, '').trim();
            this.readBuffer = this.readBuffer.slice(newlineIdx + 1);
            if (line.length > 0) {
                this.handleLine(line);
            }
            newlineIdx = this.readBuffer.indexOf('\n');
        }
    }
    handleLine(line) {
        const lower = line.toLowerCase();
        if (this.state === 'handshaking') {
            if (lower.includes('welcome') && !this.idSent) {
                this.sendHandshakeId();
                return;
            }
            if (lower === 'ok' || lower.startsWith('ok ')) {
                this.clearHandshakeTimers();
                this.state = 'ready';
                this.log.debug(`[Trinnov] Connected and authenticated with ${this.host}:${this.port}`);
                this.flushPendingCommands();
                return;
            }
            if (lower.startsWith('error')) {
                this.log.warn(`[Trinnov] Handshake warning from ${this.host}:${this.port}: ${line}`);
                return;
            }
        }
        if (lower.startsWith('error')) {
            this.log.warn(`[Trinnov] ${this.host}:${this.port} returned ${line}`);
        }
        else {
            this.log.debug(`[Trinnov ${this.host}:${this.port}] ${line}`);
        }
    }
    sendHandshakeId() {
        if (this.idSent || this.state !== 'handshaking' || !this.socket || this.socket.destroyed) {
            return;
        }
        this.idSent = true;
        if (this.welcomeFallbackTimer) {
            clearTimeout(this.welcomeFallbackTimer);
            this.welcomeFallbackTimer = null;
        }
        this.writeLine(`id ${this.clientId}`);
    }
    flushPendingCommands() {
        if (this.state !== 'ready' || !this.socket || this.socket.destroyed || !this.socket.writable) {
            return;
        }
        const commands = this.pendingCommands.splice(0, this.pendingCommands.length);
        for (const cmd of commands) {
            this.writeLine(cmd);
        }
    }
    writeLine(line) {
        if (!this.socket || this.socket.destroyed || !this.socket.writable) {
            return;
        }
        this.log.debug(`[Trinnov ${this.host}:${this.port}] -> ${line}`);
        this.socket.write(`${line}\n`);
    }
    resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.idleTimeoutMs > 0) {
            this.idleTimer = setTimeout(() => {
                if (this.socket && !this.socket.destroyed) {
                    this.log.debug(`[Trinnov] Closing idle connection to ${this.host}:${this.port}`);
                    if (this.state === 'ready' && this.socket.writable) {
                        try {
                            this.socket.write('bye\n');
                        }
                        catch {
                            // Ignore write error on idle close
                        }
                    }
                    this.socket.end();
                }
            }, this.idleTimeoutMs);
            this.idleTimer.unref();
        }
    }
    handleFailure(message) {
        // Drop queued volume commands on connection failure so they never replay in a burst later
        this.pendingCommands = [];
        const now = Date.now();
        if (now - this.lastWarnAt > 10000) {
            this.lastWarnAt = now;
            this.log.warn(`[Trinnov] ${message}`);
        }
        else {
            this.log.debug(`[Trinnov] ${message}`);
        }
        this.cleanupSocket();
    }
    cleanupSocket() {
        this.clearAllTimers();
        if (this.socket) {
            if (!this.socket.destroyed) {
                this.socket.destroy();
            }
            this.socket = null;
        }
        this.state = 'disconnected';
        this.idSent = false;
        this.readBuffer = '';
    }
    clearConnectTimer() {
        if (this.connectTimer) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
    }
    clearHandshakeTimers() {
        if (this.welcomeFallbackTimer) {
            clearTimeout(this.welcomeFallbackTimer);
            this.welcomeFallbackTimer = null;
        }
        if (this.handshakeTimer) {
            clearTimeout(this.handshakeTimer);
            this.handshakeTimer = null;
        }
    }
    clearAllTimers() {
        this.clearConnectTimer();
        this.clearHandshakeTimers();
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}
exports.TrinnovTcpClient = TrinnovTcpClient;
class TrinnovClientPool {
    options;
    log;
    clients = new Map();
    constructor(options, log) {
        this.options = options;
        this.log = log;
    }
    adjustVolume(target, deltaDb) {
        this.getClient(target).adjustVolume(deltaDb);
    }
    toggleMute(target) {
        this.getClient(target).toggleMute();
    }
    stopAll() {
        for (const client of this.clients.values()) {
            client.stop();
        }
        this.clients.clear();
    }
    getClient(target) {
        const key = `${target.host.toLowerCase()}:${target.port}`;
        let client = this.clients.get(key);
        if (!client) {
            client = new TrinnovTcpClient({
                host: target.host,
                port: target.port,
                clientId: this.options.clientId,
                idleTimeoutMs: this.options.idleTimeoutMs,
                connectTimeoutMs: this.options.connectTimeoutMs,
                socketFactory: this.options.socketFactory,
            }, this.log);
            this.clients.set(key, client);
        }
        return client;
    }
}
exports.TrinnovClientPool = TrinnovClientPool;
//# sourceMappingURL=trinnovClient.js.map