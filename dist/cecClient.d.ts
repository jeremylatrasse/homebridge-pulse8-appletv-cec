import { EventEmitter } from 'node:events';
export type CecHoldMode = 'longPress' | 'repeat';
export type CecKeyType = 'volumeUp' | 'volumeDown' | 'mute';
export type CecPressType = 'single' | 'long';
export interface CecLogger {
    info(message: string, ...parameters: unknown[]): void;
    warn(message: string, ...parameters: unknown[]): void;
    error(message: string, ...parameters: unknown[]): void;
    debug(message: string, ...parameters: unknown[]): void;
}
export interface CecDiscoveredDevice {
    logicalAddress: string;
    logicalAddressNum: number;
    deviceType: string;
    physicalAddress: string;
    activeSource: boolean;
    vendor: string;
    osdString: string;
    isAppleTv: boolean;
}
export interface CecKeyEvent {
    logicalAddress: string;
    key: CecKeyType;
    pressType: CecPressType;
    timestamp: number;
}
export interface CecVolumeCommandEvent {
    logicalAddress: string;
    key: CecKeyType;
    isRepeat: boolean;
    timestamp: number;
}
export interface CecTrafficFrame {
    src: string;
    dst: string;
    opcode: string;
    arg?: string;
    bytes: string[];
}
export interface CecClientOptions {
    cecClientPath?: string;
    portPath?: string;
    osdName?: string;
    hdmiPort?: number;
    holdMode?: CecHoldMode;
    holdDelayMs?: number;
    holdRepeatMs?: number;
    holdSafetyMs?: number;
    powerDebounceMs?: number;
    rescanIntervalSec?: number;
    rawSender?: (cmd: string) => void;
}
/**
 * Parse a `cec-client` `scan` output block into structured CEC devices.
 */
export declare function parseScanOutput(lines: string[]): CecDiscoveredDevice[];
/**
 * Parse a `cec-client -d 8` incoming TRAFFIC line (e.g. `TRAFFIC: [  123] >> 45:44:41`).
 */
export declare function parseTrafficFrame(line: string): CecTrafficFrame | null;
export declare class Pulse8CecClient extends EventEmitter {
    private readonly log;
    private readonly cecClientPath;
    private readonly portPath?;
    private readonly osdName;
    private readonly hdmiPort?;
    private readonly holdMode;
    private readonly holdDelayMs;
    private readonly holdRepeatMs;
    private readonly holdSafetyMs;
    private readonly powerDebounceMs;
    private readonly rescanIntervalSec;
    private readonly rawSender?;
    private proc;
    private rl;
    private respawnTimer;
    private rescanTimer;
    private scanSettleTimer;
    private isShuttingDown;
    private adapterReady;
    private inScan;
    private scanBuffer;
    private lastScanRequestedAt;
    private readonly discoveredAppleTvs;
    private readonly powerStates;
    private readonly lastPowerTransitionAt;
    private readonly holds;
    constructor(options: CecClientOptions, log: CecLogger);
    start(): void;
    stop(): void;
    getDiscoveredAppleTvs(): CecDiscoveredDevice[];
    getBusPowerState(logicalAddress: string): boolean | null;
    runScan(): void;
    sendRaw(cmd: string): void;
    enableSystemAudioMode(): void;
    handleLine(line: string): void;
    private scheduleScanSettle;
    private finalizeScan;
    private clearScanTimers;
    private isAllowedInitiator;
    private handleTrafficFrame;
    private recordBusPowerState;
    private handleVolumeKeyPress;
    private handleVolumeKeyRelease;
    private stopHold;
    private stopAllHolds;
    private emitKeyEvent;
    private emitVolumeCommand;
}
