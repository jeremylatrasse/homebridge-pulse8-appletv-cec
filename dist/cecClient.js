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
exports.Pulse8CecClient = void 0;
exports.parseScanOutput = parseScanOutput;
exports.parseTrafficFrame = parseTrafficFrame;
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const readline = __importStar(require("node:readline"));
const PLAYBACK_LOGICAL_ADDRESSES = new Set(['3', '4', '6', '8', 'b']);
/**
 * Parse a `cec-client` `scan` output block into structured CEC devices.
 */
function parseScanOutput(lines) {
    const devices = [];
    let current = null;
    const finalizeCurrent = () => {
        if (!current) {
            return;
        }
        const vendorLower = current.vendor.toLowerCase();
        const osdLower = current.osdString.toLowerCase();
        current.isAppleTv = vendorLower.includes('apple') || osdLower.includes('apple');
        devices.push(current);
        current = null;
    };
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const headerMatch = line.match(/^device\s+#([0-9a-fA-F]+)\s*:\s*(.+)$/i);
        if (headerMatch) {
            finalizeCurrent();
            const rawId = headerMatch[1].trim();
            const num = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : parseInt(rawId, 16);
            const logicalAddress = Number.isNaN(num) ? rawId.toLowerCase() : num.toString(16).toLowerCase();
            current = {
                logicalAddress,
                logicalAddressNum: Number.isNaN(num) ? -1 : num,
                deviceType: headerMatch[2].trim(),
                physicalAddress: '',
                activeSource: false,
                vendor: '',
                osdString: '',
                isAppleTv: false,
            };
            continue;
        }
        if (!current) {
            continue;
        }
        const addressMatch = line.match(/^address\s*:\s*([0-9a-fA-F.]+)/i);
        if (addressMatch) {
            current.physicalAddress = addressMatch[1].trim();
            continue;
        }
        const activeMatch = line.match(/^active source\s*:\s*(.+)$/i);
        if (activeMatch) {
            const val = activeMatch[1].trim().toLowerCase();
            current.activeSource = val === 'yes' || val === 'true' || val === '1';
            continue;
        }
        const vendorMatch = line.match(/^vendor\s*:\s*(.+)$/i);
        if (vendorMatch) {
            current.vendor = vendorMatch[1].trim();
            continue;
        }
        const osdMatch = line.match(/^osd string\s*:\s*(.+)$/i);
        if (osdMatch) {
            current.osdString = osdMatch[1].trim();
        }
    }
    finalizeCurrent();
    return devices;
}
/**
 * Parse a `cec-client -d 8` incoming TRAFFIC line (e.g. `TRAFFIC: [  123] >> 45:44:41`).
 */
function parseTrafficFrame(line) {
    const arrowIdx = line.indexOf('>>');
    if (arrowIdx === -1) {
        return null;
    }
    const payload = line.slice(arrowIdx + 2).trim();
    const tokens = payload.split(/\s+/)[0]?.split(':').map((b) => b.trim().toLowerCase()) ?? [];
    if (tokens.length < 2) {
        return null;
    }
    const header = tokens[0];
    if (!/^[0-9a-f]{2}$/.test(header)) {
        return null;
    }
    for (let i = 1; i < tokens.length; i++) {
        if (!/^[0-9a-f]{2}$/.test(tokens[i])) {
            return null;
        }
    }
    return {
        src: header[0],
        dst: header[1],
        opcode: tokens[1],
        arg: tokens[2],
        bytes: tokens,
    };
}
class Pulse8CecClient extends node_events_1.EventEmitter {
    log;
    cecClientPath;
    portPath;
    osdName;
    hdmiPort;
    holdMode;
    holdDelayMs;
    holdRepeatMs;
    holdSafetyMs;
    powerDebounceMs;
    rescanIntervalSec;
    rawSender;
    proc = null;
    rl = null;
    respawnTimer = null;
    rescanTimer = null;
    scanSettleTimer = null;
    isShuttingDown = false;
    adapterReady = false;
    inScan = false;
    scanBuffer = [];
    lastScanRequestedAt = 0;
    // Discovered Apple TVs keyed by lowercase hex logical address nibble ('4', '8', 'b', ...)
    discoveredAppleTvs = new Map();
    // Internal bus power tracking starting at null (unknown) so Standby works even if Apple TV was already awake at boot
    powerStates = new Map();
    lastPowerTransitionAt = new Map();
    // Active hold state per initiator logical address
    holds = new Map();
    constructor(options, log) {
        super();
        this.log = log;
        this.cecClientPath = options.cecClientPath?.trim() || 'cec-client';
        this.portPath = options.portPath?.trim() || undefined;
        this.osdName = (options.osdName?.trim() || 'Homebridge').slice(0, 14);
        this.hdmiPort =
            typeof options.hdmiPort === 'number' && options.hdmiPort >= 1 && options.hdmiPort <= 15
                ? Math.floor(options.hdmiPort)
                : undefined;
        this.holdMode = options.holdMode === 'repeat' ? 'repeat' : 'longPress';
        this.holdDelayMs = options.holdDelayMs ?? 400;
        this.holdRepeatMs = options.holdRepeatMs ?? 150;
        this.holdSafetyMs = options.holdSafetyMs ?? 5000;
        this.powerDebounceMs = options.powerDebounceMs ?? 1500;
        this.rescanIntervalSec = options.rescanIntervalSec ?? 0;
        this.rawSender = options.rawSender;
    }
    start() {
        if (this.isShuttingDown) {
            return;
        }
        const args = ['-t', 'a', '-d', '8'];
        if (this.osdName) {
            args.push('-o', this.osdName);
        }
        if (this.hdmiPort !== undefined) {
            args.push('-p', String(this.hdmiPort));
        }
        if (this.portPath) {
            args.push(this.portPath);
        }
        this.adapterReady = false;
        this.log.info(`[CEC] Starting ${this.cecClientPath} ${args.join(' ')}`);
        const proc = (0, node_child_process_1.spawn)(this.cecClientPath, args);
        this.proc = proc;
        this.rl = readline.createInterface({ input: proc.stdout });
        this.rl.on('line', (line) => this.handleLine(line));
        proc.stderr.on('data', (data) => {
            const msg = data.toString('utf8').trim();
            if (msg) {
                this.log.debug(`[CEC stderr] ${msg}`);
            }
        });
        proc.on('error', (err) => {
            this.log.error(`[CEC] Failed to spawn ${this.cecClientPath}: ${err.message}`);
        });
        proc.on('close', (code) => {
            this.stopAllHolds();
            this.clearScanTimers();
            this.adapterReady = false;
            if (this.rl) {
                this.rl.close();
                this.rl = null;
            }
            this.proc = null;
            if (!this.isShuttingDown) {
                this.log.warn(`[CEC] cec-client exited with code ${code ?? 'unknown'}. Respawning in 3s...`);
                this.respawnTimer = setTimeout(() => this.start(), 3000);
            }
        });
        if (this.rescanIntervalSec > 0 && !this.rescanTimer) {
            this.rescanTimer = setInterval(() => {
                if (this.adapterReady) {
                    this.runScan();
                }
            }, this.rescanIntervalSec * 1000);
        }
    }
    stop() {
        this.isShuttingDown = true;
        this.stopAllHolds();
        this.clearScanTimers();
        if (this.respawnTimer) {
            clearTimeout(this.respawnTimer);
            this.respawnTimer = null;
        }
        if (this.rescanTimer) {
            clearInterval(this.rescanTimer);
            this.rescanTimer = null;
        }
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        if (this.proc) {
            try {
                this.sendRaw('q');
            }
            catch {
                // Ignore write failures during shutdown
            }
            this.proc.kill('SIGTERM');
            this.proc = null;
        }
    }
    getDiscoveredAppleTvs() {
        return Array.from(this.discoveredAppleTvs.values());
    }
    getBusPowerState(logicalAddress) {
        return this.powerStates.get(logicalAddress.toLowerCase()) ?? null;
    }
    runScan() {
        const now = Date.now();
        this.lastScanRequestedAt = now;
        this.inScan = false;
        this.scanBuffer = [];
        this.log.debug('[CEC] Running bus scan...');
        this.sendRaw('scan');
    }
    sendRaw(cmd) {
        if (this.rawSender) {
            this.rawSender(cmd);
            return;
        }
        if (this.proc && this.proc.stdin && this.proc.stdin.writable) {
            this.proc.stdin.write(`${cmd}\n`);
        }
    }
    enableSystemAudioMode() {
        this.sendRaw('tx 5F:72:01');
    }
    handleLine(line) {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        // 1. Capture `scan` output lines
        if (/^device\s+#[0-9a-fA-F]+\s*:/i.test(trimmed)) {
            this.inScan = true;
            this.scanBuffer.push(trimmed);
            this.scheduleScanSettle();
            return;
        }
        if (this.inScan) {
            if (/^(address|active source|vendor|osd string|cec version|power status|language)\s*:/i.test(trimmed)) {
                this.scanBuffer.push(trimmed);
                this.scheduleScanSettle();
                return;
            }
            if (/^currently active source\s*:/i.test(trimmed)) {
                this.finalizeScan();
                return;
            }
        }
        // 2. Adapter ready detection -> claim System Audio Mode + scan HDMI bus
        if (!this.adapterReady &&
            (trimmed.includes('waiting for input') || trimmed.includes('TRAFFIC:') || trimmed.includes('>>'))) {
            this.adapterReady = true;
            this.log.info('[CEC] Pulse-Eight adapter ready. Enabling System Audio Mode and scanning bus...');
            this.enableSystemAudioMode();
            if (trimmed.includes('waiting for input')) {
                this.runScan();
                return;
            }
            this.runScan();
        }
        // 3. Parse incoming CEC traffic frames
        const frame = parseTrafficFrame(trimmed);
        if (!frame) {
            return;
        }
        this.handleTrafficFrame(frame);
    }
    scheduleScanSettle() {
        if (this.scanSettleTimer) {
            clearTimeout(this.scanSettleTimer);
        }
        this.scanSettleTimer = setTimeout(() => {
            this.finalizeScan();
        }, 400);
    }
    finalizeScan() {
        if (this.scanSettleTimer) {
            clearTimeout(this.scanSettleTimer);
            this.scanSettleTimer = null;
        }
        if (!this.inScan) {
            return;
        }
        this.inScan = false;
        const lines = this.scanBuffer;
        this.scanBuffer = [];
        const allDevices = parseScanOutput(lines);
        const appleTvs = allDevices.filter((d) => d.isAppleTv);
        this.discoveredAppleTvs.clear();
        for (const atv of appleTvs) {
            this.discoveredAppleTvs.set(atv.logicalAddress, atv);
        }
        if (appleTvs.length === 0) {
            this.log.warn(`[CEC] Scan found ${allDevices.length} CEC device(s), but no Apple TV yet. Make sure Apple TV has 'Control TVs and Receivers' ON.`);
        }
        else {
            const summary = appleTvs
                .map((d) => `${d.osdString || 'Apple TV'} (logical=${d.logicalAddress}, physical=${d.physicalAddress || 'unknown'})`)
                .join(', ');
            this.log.info(`[CEC] Scan discovered ${appleTvs.length} Apple TV(s): ${summary}`);
        }
        this.emit('scanResult', { devices: allDevices, appleTvs });
    }
    clearScanTimers() {
        if (this.scanSettleTimer) {
            clearTimeout(this.scanSettleTimer);
            this.scanSettleTimer = null;
        }
        this.inScan = false;
        this.scanBuffer = [];
    }
    isAllowedInitiator(src) {
        if (this.discoveredAppleTvs.has(src)) {
            return true;
        }
        // If scan hasn't found any Apple TV yet (e.g. Apple TV was asleep at boot), allow playback initiators
        // and trigger a debounced scan so the Apple TV gets discovered and registered dynamically.
        if (PLAYBACK_LOGICAL_ADDRESSES.has(src)) {
            const now = Date.now();
            if (now - this.lastScanRequestedAt > 10000) {
                this.runScan();
            }
            return this.discoveredAppleTvs.size === 0;
        }
        return false;
    }
    handleTrafficFrame(frame) {
        const { src, dst, opcode, arg } = frame;
        // Frames directed to our emulated Audio System (Logical Address 5)
        if (dst === '5') {
            // Keep System Audio Mode alive across tvOS requests & status polls
            if (opcode === '70' || opcode === '7d') {
                this.enableSystemAudioMode();
                return;
            }
            // Give Audio Status -> Report Audio Status (50%, unmuted) to actual initiator
            if (opcode === '71') {
                this.sendRaw(`tx 5${src}:7a:32`);
                return;
            }
            // Give Device Power Status -> Report Power Status = On (0x00) to actual initiator
            if (opcode === '8f') {
                this.sendRaw(`tx 5${src}:90:00`);
                return;
            }
            // Remote Key Presses (User Control Pressed 0x44 / Released 0x45)
            if (!this.isAllowedInitiator(src)) {
                return;
            }
            if (opcode === '44') {
                if (arg === '41') {
                    this.handleVolumeKeyPress(src, 'volumeUp');
                }
                else if (arg === '42') {
                    this.handleVolumeKeyPress(src, 'volumeDown');
                }
                else if (arg === '43') {
                    this.stopHold(src);
                    this.emitKeyEvent(src, 'mute', 'single');
                }
                else if (arg === '40' || arg === '6c') {
                    // Remote power button intentionally ignored
                    this.log.debug(`[CEC] Ignoring remote power key (44:${arg}) from logical address ${src}`);
                }
                return;
            }
            if (opcode === '45') {
                this.handleVolumeKeyRelease(src);
            }
            return;
        }
        // Broadcast / TV-directed frames
        // Explicitly skip Report Physical Address (0x84) to avoid spamming tx 5F:72:01 on the bus
        if (dst === 'f' && opcode === '84') {
            return;
        }
        if (!this.isAllowedInitiator(src)) {
            return;
        }
        // Active Source (0x82) or Image View On (0x04) -> re-assert System Audio Mode so Siri Remote stays in HDMI-CEC volume mode
        if ((dst === 'f' && opcode === '82') || ((dst === '0' || dst === 'f') && opcode === '04')) {
            this.enableSystemAudioMode();
            this.recordBusPowerState(src, true);
            return;
        }
        // Standby (0x36)
        if (dst === 'f' && opcode === '36') {
            this.stopHold(src);
            this.recordBusPowerState(src, false);
        }
    }
    recordBusPowerState(src, turnOn) {
        const now = Date.now();
        const prev = this.powerStates.get(src) ?? null;
        const lastAt = this.lastPowerTransitionAt.get(src) ?? 0;
        if (prev === turnOn && now - lastAt < this.powerDebounceMs) {
            return;
        }
        if (prev === turnOn) {
            return;
        }
        this.powerStates.set(src, turnOn);
        this.lastPowerTransitionAt.set(src, now);
        this.log.debug(`[CEC] Bus state for logical address ${src} -> ${turnOn ? 'ON' : 'OFF'}`);
    }
    handleVolumeKeyPress(src, key) {
        const existing = this.holds.get(src);
        if (existing && existing.key === key) {
            // Some remotes/adapters re-send 44:41 while held; refresh safety timeout without restarting tap detection
            if (existing.safetyTimer) {
                clearTimeout(existing.safetyTimer);
            }
            existing.safetyTimer = setTimeout(() => {
                this.stopHold(src);
            }, this.holdSafetyMs);
            return;
        }
        this.stopHold(src);
        const hold = {
            key,
            longFired: false,
            delayTimer: null,
            repeatTimer: null,
            safetyTimer: null,
        };
        if (this.holdMode === 'repeat') {
            this.emitKeyEvent(src, key, 'single');
            hold.delayTimer = setTimeout(() => {
                this.emitKeyEvent(src, key, 'single');
                hold.repeatTimer = setInterval(() => {
                    this.emitKeyEvent(src, key, 'single');
                }, this.holdRepeatMs);
            }, this.holdDelayMs);
        }
        else {
            hold.delayTimer = setTimeout(() => {
                hold.longFired = true;
                this.emitKeyEvent(src, key, 'long');
            }, this.holdDelayMs);
        }
        hold.safetyTimer = setTimeout(() => {
            this.stopHold(src);
        }, this.holdSafetyMs);
        this.holds.set(src, hold);
    }
    handleVolumeKeyRelease(src) {
        const existing = this.holds.get(src);
        if (!existing) {
            return;
        }
        const shouldEmitSingleTap = this.holdMode === 'longPress' && !existing.longFired;
        const key = existing.key;
        this.stopHold(src);
        if (shouldEmitSingleTap) {
            this.emitKeyEvent(src, key, 'single');
        }
    }
    stopHold(src) {
        const existing = this.holds.get(src);
        if (!existing) {
            return;
        }
        if (existing.delayTimer) {
            clearTimeout(existing.delayTimer);
        }
        if (existing.repeatTimer) {
            clearInterval(existing.repeatTimer);
        }
        if (existing.safetyTimer) {
            clearTimeout(existing.safetyTimer);
        }
        this.holds.delete(src);
    }
    stopAllHolds() {
        for (const src of Array.from(this.holds.keys())) {
            this.stopHold(src);
        }
    }
    emitKeyEvent(logicalAddress, key, pressType) {
        const event = {
            logicalAddress,
            key,
            pressType,
            timestamp: Date.now(),
        };
        this.log.info(`[CEC] Apple TV (${logicalAddress}) ${key} -> ${pressType.toUpperCase()}`);
        this.emit('keyPress', event);
    }
}
exports.Pulse8CecClient = Pulse8CecClient;
//# sourceMappingURL=cecClient.js.map