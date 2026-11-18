"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrinnovClientPool = exports.TrinnovTcpClient = exports.TrinnovTargetResolver = exports.TRINNOV_DISCOVERY_FILENAME = exports.TRINNOV_DEFAULT_PORT = void 0;
exports.parseTrinnovDiscoveryPayload = parseTrinnovDiscoveryPayload;
exports.extractTrinnovTargetsFromHomebridgeConfig = extractTrinnovTargetsFromHomebridgeConfig;
const targetDiscovery_1 = require("./targetDiscovery");
Object.defineProperty(exports, "TRINNOV_DISCOVERY_FILENAME", { enumerable: true, get: function () { return targetDiscovery_1.TRINNOV_DISCOVERY_FILENAME; } });
const targetDriver_1 = require("./targetDriver");
Object.defineProperty(exports, "TRINNOV_DEFAULT_PORT", { enumerable: true, get: function () { return targetDriver_1.TRINNOV_DEFAULT_PORT; } });
function toTrinnovTarget(target) {
    return {
        id: target.id,
        name: target.name,
        host: target.host,
        port: target.port,
        powered: target.powered,
        activeSource: target.activeSource,
        volumeStepDb: target.volumeStepDb,
        httpEndpoint: target.httpEndpoint,
        source: target.source,
    };
}
function parseTrinnovDiscoveryPayload(raw, source) {
    const { targets, httpTargetsUrl } = (0, targetDiscovery_1.parseDiscoveryPayload)(raw, source);
    return {
        targets: targets.map(toTrinnovTarget),
        httpTargetsUrl,
    };
}
function extractTrinnovTargetsFromHomebridgeConfig(rawConfig) {
    return (0, targetDiscovery_1.extractTargetsFromHomebridgeConfig)(rawConfig)
        .filter((t) => t.driver === 'trinnov')
        .map(toTrinnovTarget);
}
class TrinnovTargetResolver {
    inner;
    constructor(options, log) {
        this.inner = new targetDiscovery_1.TargetResolver({
            mode: options.mode === 'enabled' ? 'trinnov' : options.mode ?? 'auto',
            host: options.host,
            port: options.port,
            volumeStepDb: options.volumeStepDb,
            discoveryUrl: options.discoveryUrl,
            storagePath: options.storagePath,
            configPath: options.configPath,
            httpFetcher: options.httpFetcher,
        }, log);
    }
    start() {
        this.inner.start();
    }
    stop() {
        this.inner.stop();
    }
    refreshSync() {
        this.inner.refreshSync();
    }
    async refreshHttp() {
        return this.inner.refreshHttp();
    }
    resolveForAppleTv(params) {
        const resolved = this.inner.resolveForAppleTv(params);
        if (!resolved) {
            return null;
        }
        return {
            target: toTrinnovTarget(resolved.target),
            stepDb: resolved.stepDb,
        };
    }
    getCandidateList() {
        return this.inner.getCandidateList().map(toTrinnovTarget);
    }
}
exports.TrinnovTargetResolver = TrinnovTargetResolver;
class TrinnovTcpClient {
    host;
    port;
    driver;
    constructor(options, log) {
        this.driver = new targetDriver_1.TcpTargetDriver({
            host: options.host,
            port: options.port ?? targetDriver_1.TRINNOV_DEFAULT_PORT,
            driverLabel: 'Trinnov',
            clientId: options.clientId,
            idleTimeoutMs: options.idleTimeoutMs,
            connectTimeoutMs: options.connectTimeoutMs,
            commands: targetDriver_1.TRINNOV_TCP_PRESET,
            socketFactory: options.socketFactory,
        }, log);
        this.host = this.driver.host;
        this.port = this.driver.port;
    }
    adjustVolume(deltaDb) {
        if (deltaDb >= 0) {
            this.driver.sendAction('volumeUp', { stepDb: deltaDb });
        }
        else {
            this.driver.sendAction('volumeDown', { stepDb: Math.abs(deltaDb) });
        }
    }
    toggleMute() {
        this.driver.sendAction('muteToggle');
    }
    sendCommand(command) {
        this.driver.sendRawLine(command);
    }
    stop() {
        this.driver.disconnect();
    }
}
exports.TrinnovTcpClient = TrinnovTcpClient;
class TrinnovClientPool {
    pool;
    constructor(options, log) {
        this.pool = new targetDriver_1.TargetDriverPool(options, log);
    }
    adjustVolume(target, deltaDb) {
        const spec = {
            id: target.id,
            name: target.name,
            driver: 'trinnov',
            host: target.host,
            port: target.port,
            volumeStepDb: target.volumeStepDb,
        };
        if (deltaDb >= 0) {
            this.pool.sendAction(spec, 'volumeUp', { stepDb: deltaDb });
        }
        else {
            this.pool.sendAction(spec, 'volumeDown', { stepDb: Math.abs(deltaDb) });
        }
    }
    toggleMute(target) {
        this.pool.sendAction({
            id: target.id,
            name: target.name,
            driver: 'trinnov',
            host: target.host,
            port: target.port,
            volumeStepDb: target.volumeStepDb,
        }, 'muteToggle');
    }
    stopAll() {
        this.pool.stopAll();
    }
}
exports.TrinnovClientPool = TrinnovClientPool;
//# sourceMappingURL=trinnovClient.js.map