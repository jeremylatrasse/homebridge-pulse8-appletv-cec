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
exports.TargetDriverPool = exports.HttpTargetDriver = exports.TcpTargetDriver = exports.YAMAHA_HTTP_PRESET = exports.LYNGDORF_TCP_PRESET = exports.STORMAUDIO_TCP_PRESET = exports.PIONEER_TCP_PRESET = exports.DENON_MARANTZ_TCP_PRESET = exports.ANTHEM_TCP_PRESET = exports.TRINNOV_TCP_PRESET = exports.TRINNOV_DEFAULT_PORT = void 0;
exports.matchBuiltInTargetPreset = matchBuiltInTargetPreset;
exports.normalizePort = normalizePort;
const net = __importStar(require("node:net"));
exports.TRINNOV_DEFAULT_PORT = 44100;
exports.TRINNOV_TCP_PRESET = {
    init: 'id {{clientId}}',
    volumeUp: 'dvolume {{stepDb}}',
    volumeDown: 'dvolume -{{stepDb}}',
    mute: 'mute 2',
    bye: 'bye',
    lineEnding: '\n',
    waitForBannerMs: 250,
    bannerIncludes: 'welcome',
    handshakeExpect: 'ok',
};
exports.ANTHEM_TCP_PRESET = {
    volumeUp: 'Z1VUP;',
    volumeDown: 'Z1VDN;',
    mute: 'Z1MUT;',
    powerOn: 'Z1POW1;',
    powerOff: 'Z1POW0;',
    lineEnding: '\n',
};
exports.DENON_MARANTZ_TCP_PRESET = {
    volumeUp: 'MVUP',
    volumeDown: 'MVDOWN',
    mute: 'MUON',
    powerOn: 'PWON',
    powerOff: 'PWSTANDBY',
    lineEnding: '\r',
};
exports.PIONEER_TCP_PRESET = {
    volumeUp: 'VU',
    volumeDown: 'VD',
    mute: 'MZ',
    powerOn: 'PO',
    powerOff: 'PF',
    lineEnding: '\r',
};
exports.STORMAUDIO_TCP_PRESET = {
    volumeUp: 'ssp.vol.up',
    volumeDown: 'ssp.vol.down',
    mute: 'ssp.mute.toggle',
    powerOn: 'ssp.power.on',
    powerOff: 'ssp.power.off',
    lineEnding: '\n',
};
exports.LYNGDORF_TCP_PRESET = {
    volumeUp: '!VOLUP',
    volumeDown: '!VOLDN',
    mute: '!MUTE',
    powerOn: '!POWERON',
    powerOff: '!POWEROFF',
    lineEnding: '\r',
};
exports.YAMAHA_HTTP_PRESET = {
    volumeUp: { url: '/YamahaExtendedControl/v1/main/setVolume?volume=up', method: 'GET' },
    volumeDown: { url: '/YamahaExtendedControl/v1/main/setVolume?volume=down', method: 'GET' },
    powerOn: { url: '/YamahaExtendedControl/v1/main/setPower?power=on', method: 'GET' },
    powerOff: { url: '/YamahaExtendedControl/v1/main/setPower?power=standby', method: 'GET' },
};
const PRESET_MATCHERS = [
    {
        keywords: ['trinnov'],
        preset: {
            id: 'trinnov',
            driver: 'trinnov',
            defaultPort: exports.TRINNOV_DEFAULT_PORT,
            tcpCommands: exports.TRINNOV_TCP_PRESET,
        },
    },
    {
        keywords: ['anthem', 'mrx', 'avm'],
        preset: {
            id: 'anthem',
            driver: 'tcp',
            defaultPort: 14999,
            tcpCommands: exports.ANTHEM_TCP_PRESET,
        },
    },
    {
        keywords: ['denon', 'marantz'],
        preset: {
            id: 'denon-marantz',
            driver: 'tcp',
            defaultPort: 23,
            tcpCommands: exports.DENON_MARANTZ_TCP_PRESET,
        },
    },
    {
        keywords: ['pioneer'],
        preset: {
            id: 'pioneer',
            driver: 'tcp',
            defaultPort: 23,
            tcpCommands: exports.PIONEER_TCP_PRESET,
        },
    },
    {
        keywords: ['stormaudio', 'storm-audio', 'storm'],
        preset: {
            id: 'stormaudio',
            driver: 'tcp',
            defaultPort: 23,
            tcpCommands: exports.STORMAUDIO_TCP_PRESET,
        },
    },
    {
        keywords: ['lyngdorf'],
        preset: {
            id: 'lyngdorf',
            driver: 'tcp',
            defaultPort: 84,
            tcpCommands: exports.LYNGDORF_TCP_PRESET,
        },
    },
    {
        keywords: ['yamaha'],
        preset: {
            id: 'yamaha',
            driver: 'http',
            defaultPort: 80,
            httpEndpoints: exports.YAMAHA_HTTP_PRESET,
        },
    },
];
function matchBuiltInTargetPreset(hint) {
    const lower = hint.toLowerCase();
    for (const entry of PRESET_MATCHERS) {
        if (entry.keywords.some((kw) => lower.includes(kw))) {
            return entry.preset;
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
function unescapeControlChars(input) {
    return input
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
}
function renderTemplate(template, vars) {
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawKey) => {
        const key = rawKey.trim();
        return vars[key] ?? '';
    });
}
function renderTemplateValue(value, vars) {
    if (typeof value === 'string') {
        return renderTemplate(value, vars);
    }
    if (Array.isArray(value)) {
        return value.map((item) => renderTemplateValue(item, vars));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = renderTemplateValue(v, vars);
        }
        return out;
    }
    return value;
}
function buildTemplateVars(action, clientId, context) {
    const stepDb = typeof context?.stepDb === 'number' && Number.isFinite(context.stepDb)
        ? context.stepDb
        : 1;
    return {
        stepDb: Number(stepDb.toFixed(2)).toString(),
        '-stepDb': Number((-stepDb).toFixed(2)).toString(),
        clientId,
        action,
        source: context?.sourceName ?? '',
        logicalAddress: context?.logicalAddress ?? '',
    };
}
function encodeTcpPayload(rendered, lineEnding) {
    const trimmed = rendered.trim();
    if (!trimmed) {
        return null;
    }
    if (/^hex:/i.test(trimmed)) {
        const hexBody = trimmed.slice(4).replace(/[^0-9a-fA-F]/g, '');
        if (hexBody.length === 0 || hexBody.length % 2 !== 0) {
            return null;
        }
        return Buffer.from(hexBody, 'hex');
    }
    const unescaped = unescapeControlChars(rendered);
    const withEnding = unescaped.endsWith('\n') || unescaped.endsWith('\r') ? unescaped : `${unescaped}${lineEnding}`;
    return Buffer.from(withEnding, 'utf8');
}
class TcpTargetDriver {
    log;
    key;
    host;
    port;
    driverLabel;
    clientId;
    idleTimeoutMs;
    connectTimeoutMs;
    commands;
    lineEnding;
    socketFactory;
    socket = null;
    state = 'disconnected';
    isStopped = false;
    readBuffer = '';
    initSent = false;
    pendingPayloads = [];
    connectTimer = null;
    welcomeFallbackTimer = null;
    handshakeTimer = null;
    idleTimer = null;
    lastWarnAt = 0;
    constructor(options, log) {
        this.log = log;
        this.host = options.host;
        this.port = normalizePort(options.port);
        this.driverLabel = options.driverLabel || 'TCP';
        this.key = `${this.driverLabel.toLowerCase()}:${this.host.toLowerCase()}:${this.port}`;
        this.clientId = (options.clientId?.trim() || 'homebridge-pulse8-appletv-cec').replace(/[\r\n]/g, ' ');
        this.idleTimeoutMs = options.idleTimeoutMs ?? 60000;
        this.connectTimeoutMs = options.connectTimeoutMs ?? 2000;
        this.commands = options.commands ?? {};
        this.lineEnding = unescapeControlChars(this.commands.lineEnding ?? '\n');
        this.socketFactory =
            options.socketFactory ?? ((port, host) => net.createConnection({ port, host }));
    }
    connect() {
        if (this.isStopped || this.state !== 'disconnected') {
            return;
        }
        this.state = 'connecting';
        this.initSent = false;
        this.readBuffer = '';
        const socket = this.socketFactory(this.port, this.host);
        this.socket = socket;
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 15000);
        this.connectTimer = setTimeout(() => {
            this.handleFailure(`Connection to ${this.driverLabel} ${this.host}:${this.port} timed out after ${this.connectTimeoutMs}ms`);
        }, this.connectTimeoutMs);
        socket.on('connect', () => {
            if (this.socket !== socket) {
                return;
            }
            this.clearConnectTimer();
            const hasInit = this.getInitCommands().length > 0;
            const expectHandshake = Boolean(this.commands.handshakeExpect?.trim());
            if (hasInit && expectHandshake) {
                this.state = 'handshaking';
                const waitMs = Math.max(0, this.commands.waitForBannerMs ?? 250);
                if (waitMs === 0) {
                    this.sendInitCommands();
                }
                else {
                    this.welcomeFallbackTimer = setTimeout(() => {
                        this.sendInitCommands();
                    }, waitMs);
                }
                this.handshakeTimer = setTimeout(() => {
                    this.handleFailure(`${this.driverLabel} ${this.host}:${this.port} handshake timed out`);
                }, 2000);
                return;
            }
            if (hasInit) {
                this.sendInitCommands();
            }
            this.state = 'ready';
            this.log.debug(`[${this.driverLabel}] Connected to ${this.host}:${this.port}`);
            this.flushPendingPayloads();
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
            this.handleFailure(`${this.driverLabel} TCP error (${this.host}:${this.port}): ${err.message}`);
        });
        socket.on('close', () => {
            if (this.socket !== socket) {
                return;
            }
            this.cleanupSocket();
        });
    }
    sendAction(action, context) {
        if (this.isStopped) {
            return;
        }
        const template = this.resolveActionTemplate(action);
        if (!template) {
            this.log.debug(`[${this.driverLabel}] No command configured for action "${action}" on ${this.host}:${this.port}`);
            return;
        }
        const vars = buildTemplateVars(action, this.clientId, context);
        const rendered = renderTemplate(template, vars);
        const payload = encodeTcpPayload(rendered, this.lineEnding);
        if (!payload) {
            return;
        }
        this.enqueueOrWritePayload(payload);
    }
    sendRawLine(line) {
        if (this.isStopped) {
            return;
        }
        const payload = encodeTcpPayload(line, this.lineEnding);
        if (!payload) {
            return;
        }
        this.enqueueOrWritePayload(payload);
    }
    disconnect() {
        this.isStopped = true;
        this.pendingPayloads = [];
        this.clearAllTimers();
        if (this.socket && !this.socket.destroyed) {
            const sock = this.socket;
            const byePayload = this.renderByePayload();
            if (this.state === 'ready' && sock.writable && byePayload) {
                try {
                    sock.end(byePayload);
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
    resolveActionTemplate(action) {
        switch (action) {
            case 'volumeUp':
                return this.commands.volumeUp;
            case 'volumeDown':
                return this.commands.volumeDown;
            case 'muteToggle':
                return this.commands.mute;
            case 'powerOn':
                return this.commands.powerOn;
            case 'powerOff':
                return this.commands.powerOff;
            case 'powerToggle':
                return this.commands.powerToggle;
        }
    }
    getInitCommands() {
        if (!this.commands.init) {
            return [];
        }
        return Array.isArray(this.commands.init) ? this.commands.init : [this.commands.init];
    }
    renderByePayload() {
        if (!this.commands.bye) {
            return null;
        }
        const vars = buildTemplateVars('bye', this.clientId);
        const rendered = renderTemplate(this.commands.bye, vars);
        return encodeTcpPayload(rendered, this.lineEnding);
    }
    enqueueOrWritePayload(payload) {
        this.isStopped = false;
        this.resetIdleTimer();
        if (this.state === 'ready' && this.socket && !this.socket.destroyed && this.socket.writable) {
            this.writePayload(payload);
            return;
        }
        if (this.pendingPayloads.length >= 12) {
            this.pendingPayloads.shift();
        }
        this.pendingPayloads.push(payload);
        if (this.state === 'disconnected') {
            this.connect();
        }
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
            const bannerMatch = this.commands.bannerIncludes?.trim().toLowerCase();
            if (bannerMatch && lower.includes(bannerMatch) && !this.initSent) {
                this.sendInitCommands();
                return;
            }
            const expected = this.commands.handshakeExpect?.trim().toLowerCase();
            if (expected && (lower === expected || lower.startsWith(`${expected} `))) {
                this.clearHandshakeTimers();
                this.state = 'ready';
                this.log.debug(`[${this.driverLabel}] Connected and authenticated with ${this.host}:${this.port}`);
                this.flushPendingPayloads();
                return;
            }
            if (lower.startsWith('error')) {
                this.log.warn(`[${this.driverLabel}] Handshake warning from ${this.host}:${this.port}: ${line}`);
                return;
            }
        }
        if (lower.startsWith('error')) {
            this.log.warn(`[${this.driverLabel}] ${this.host}:${this.port} returned ${line}`);
        }
        else {
            this.log.debug(`[${this.driverLabel} ${this.host}:${this.port}] ${line}`);
        }
    }
    sendInitCommands() {
        if (this.initSent || !this.socket || this.socket.destroyed) {
            return;
        }
        this.initSent = true;
        if (this.welcomeFallbackTimer) {
            clearTimeout(this.welcomeFallbackTimer);
            this.welcomeFallbackTimer = null;
        }
        const vars = buildTemplateVars('init', this.clientId);
        for (const rawCmd of this.getInitCommands()) {
            const rendered = renderTemplate(rawCmd, vars);
            const payload = encodeTcpPayload(rendered, this.lineEnding);
            if (payload) {
                this.writePayload(payload);
            }
        }
    }
    flushPendingPayloads() {
        if (this.state !== 'ready' || !this.socket || this.socket.destroyed || !this.socket.writable) {
            return;
        }
        const payloads = this.pendingPayloads.splice(0, this.pendingPayloads.length);
        for (const payload of payloads) {
            this.writePayload(payload);
        }
    }
    writePayload(payload) {
        if (!this.socket || this.socket.destroyed || !this.socket.writable) {
            return;
        }
        this.log.debug(`[${this.driverLabel} ${this.host}:${this.port}] -> ${payload.toString('utf8').trim()}`);
        this.socket.write(payload);
    }
    resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.idleTimeoutMs > 0) {
            this.idleTimer = setTimeout(() => {
                if (this.socket && !this.socket.destroyed) {
                    this.log.debug(`[${this.driverLabel}] Closing idle connection to ${this.host}:${this.port}`);
                    const byePayload = this.renderByePayload();
                    if (this.state === 'ready' && this.socket.writable && byePayload) {
                        try {
                            this.socket.write(byePayload);
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
        // Drop queued commands on connection failure so they never replay in a burst later
        this.pendingPayloads = [];
        const now = Date.now();
        if (now - this.lastWarnAt > 10000) {
            this.lastWarnAt = now;
            this.log.warn(`[${this.driverLabel}] ${message}`);
        }
        else {
            this.log.debug(`[${this.driverLabel}] ${message}`);
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
        this.initSent = false;
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
exports.TcpTargetDriver = TcpTargetDriver;
class HttpTargetDriver {
    log;
    key;
    baseUrl;
    endpoints;
    requestTimeoutMs;
    fetcher;
    lastWarnAt = 0;
    constructor(options, log) {
        this.log = log;
        if (options.baseUrl) {
            this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
        }
        else if (options.host) {
            const port = options.port ?? 80;
            const scheme = port === 443 ? 'https' : 'http';
            this.baseUrl = `${scheme}://${options.host}:${port}`;
        }
        this.key = `http:${this.baseUrl || 'custom'}`;
        this.endpoints = options.endpoints ?? {};
        this.requestTimeoutMs = options.requestTimeoutMs ?? 3000;
        this.fetcher =
            options.fetcher ??
                ((url, init) => fetch(url, init));
    }
    connect() {
        // HTTP driver is stateless per request
    }
    async sendAction(action, context) {
        const rawDef = this.resolveEndpoint(action);
        if (!rawDef) {
            this.log.debug(`[HTTP] No endpoint configured for action "${action}"`);
            return;
        }
        const def = typeof rawDef === 'string' ? { url: rawDef, method: 'POST' } : rawDef;
        const vars = buildTemplateVars(action, 'homebridge-pulse8-appletv-cec', context);
        const renderedUrl = renderTemplate(def.url.trim(), vars);
        const resolvedUrl = this.resolveUrl(renderedUrl);
        if (!resolvedUrl) {
            return;
        }
        const method = (def.method || 'POST').toUpperCase();
        const headers = {};
        if (def.headers) {
            for (const [k, v] of Object.entries(def.headers)) {
                headers[k] = renderTemplate(String(v), vars);
            }
        }
        let body;
        if (def.body !== undefined && def.body !== null && method !== 'GET') {
            const renderedBody = renderTemplateValue(def.body, vars);
            if (typeof renderedBody === 'string') {
                body = renderedBody;
            }
            else {
                body = JSON.stringify(renderedBody);
                const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
                if (!hasContentType) {
                    headers['Content-Type'] = 'application/json';
                }
            }
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            this.log.debug(`[HTTP] ${method} ${resolvedUrl}`);
            const res = await this.fetcher(resolvedUrl, {
                method,
                headers,
                body,
                signal: controller.signal,
            });
            if (!res.ok) {
                this.warnThrottled(`[HTTP] ${method} ${resolvedUrl} returned HTTP ${res.status}`);
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.warnThrottled(`[HTTP] ${method} ${resolvedUrl} failed: ${msg}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
    disconnect() {
        // Nothing persistent to close
    }
    resolveEndpoint(action) {
        switch (action) {
            case 'volumeUp':
                return this.endpoints.volumeUp;
            case 'volumeDown':
                return this.endpoints.volumeDown;
            case 'muteToggle':
                return this.endpoints.mute;
            case 'powerOn':
                return this.endpoints.powerOn;
            case 'powerOff':
                return this.endpoints.powerOff;
            case 'powerToggle':
                return this.endpoints.powerToggle;
        }
    }
    resolveUrl(url) {
        if (!url) {
            return null;
        }
        if (/^https?:\/\//i.test(url)) {
            return url;
        }
        if (this.baseUrl) {
            const suffix = url.startsWith('/') ? url : `/${url}`;
            return `${this.baseUrl}${suffix}`;
        }
        return null;
    }
    warnThrottled(message) {
        const now = Date.now();
        if (now - this.lastWarnAt > 10000) {
            this.lastWarnAt = now;
            this.log.warn(message);
        }
        else {
            this.log.debug(message);
        }
    }
}
exports.HttpTargetDriver = HttpTargetDriver;
class TargetDriverPool {
    options;
    log;
    drivers = new Map();
    constructor(options, log) {
        this.options = options;
        this.log = log;
    }
    sendAction(target, action, context) {
        const driver = this.getDriver(target);
        void driver.sendAction(action, context);
    }
    stopAll() {
        for (const driver of this.drivers.values()) {
            driver.disconnect();
        }
        this.drivers.clear();
    }
    getDriver(target) {
        const effectiveCommands = target.driver === 'trinnov'
            ? { ...exports.TRINNOV_TCP_PRESET, ...this.options.tcpCommands, ...target.tcpCommands }
            : { ...this.options.tcpCommands, ...target.tcpCommands };
        const effectiveHttpEndpoints = {
            ...this.options.httpEndpoints,
            ...target.httpEndpoints,
        };
        const configFingerprint = target.driver === 'http'
            ? JSON.stringify(effectiveHttpEndpoints)
            : JSON.stringify(effectiveCommands);
        const key = `${target.driver}:${target.host.toLowerCase()}:${target.port}:${configFingerprint}`;
        let driver = this.drivers.get(key);
        if (!driver) {
            if (target.driver === 'http') {
                driver = new HttpTargetDriver({
                    host: target.host,
                    port: target.port,
                    baseUrl: target.httpEndpoint,
                    endpoints: effectiveHttpEndpoints,
                    requestTimeoutMs: this.options.requestTimeoutMs,
                    fetcher: this.options.httpFetcher,
                }, this.log);
            }
            else {
                driver = new TcpTargetDriver({
                    host: target.host,
                    port: target.port,
                    driverLabel: target.driver === 'trinnov' ? 'Trinnov' : 'TCP',
                    clientId: this.options.clientId,
                    idleTimeoutMs: this.options.idleTimeoutMs,
                    connectTimeoutMs: this.options.connectTimeoutMs,
                    commands: effectiveCommands,
                    socketFactory: this.options.socketFactory,
                }, this.log);
            }
            this.drivers.set(key, driver);
        }
        return driver;
    }
}
exports.TargetDriverPool = TargetDriverPool;
//# sourceMappingURL=targetDriver.js.map