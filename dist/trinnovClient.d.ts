import * as net from 'node:net';
import { CecLogger } from './cecClient';
export declare const TRINNOV_DEFAULT_PORT = 44100;
export declare const TRINNOV_DISCOVERY_FILENAME = "homebridge-trinnov-discovery.json";
export type TrinnovControlMode = 'auto' | 'enabled' | 'disabled';
export type TrinnovMuteAction = 'toggle' | 'ignore';
export type TrinnovTargetSource = 'deviceConfig' | 'platformConfig' | 'discoveryHttp' | 'discoveryFile' | 'homebridgeConfig';
export interface TrinnovProcessorTarget {
    id?: string;
    name?: string;
    host: string;
    port: number;
    powered?: boolean;
    activeSource?: string;
    volumeStepDb?: number;
    httpEndpoint?: string;
    source: TrinnovTargetSource;
}
export interface TrinnovDiscoveryProcessorEntry {
    id?: string;
    name?: string;
    host?: string;
    ip?: string;
    ipAddress?: string;
    address?: string;
    port?: number;
    powered?: boolean;
    activeSource?: string;
    volumeStepDb?: number;
    httpEndpoint?: string;
    enabled?: boolean;
}
export interface TrinnovDiscoveryPayload {
    version?: number;
    plugin?: string;
    updatedAt?: string;
    pid?: number;
    http?: {
        baseUrl?: string;
        targetsPath?: string;
    };
    processors?: TrinnovDiscoveryProcessorEntry[];
    id?: string;
    name?: string;
    host?: string;
    ip?: string;
    port?: number;
    powered?: boolean;
    activeSource?: string;
    volumeStepDb?: number;
}
export interface AppleTvTrinnovOverride {
    trinnovEnabled?: boolean;
    trinnovId?: string;
    trinnovHost?: string;
    trinnovPort?: number;
    volumeStepDb?: number;
}
export interface TrinnovTargetResolverOptions {
    mode?: TrinnovControlMode;
    host?: string;
    port?: number;
    volumeStepDb?: number;
    discoveryUrl?: string;
    storagePath?: string;
    configPath?: string;
    httpFetcher?: (url: string, timeoutMs: number) => Promise<string>;
}
export interface ResolvedTrinnovTarget {
    target: TrinnovProcessorTarget;
    stepDb: number;
}
export declare function parseTrinnovDiscoveryPayload(raw: unknown, source: 'discoveryFile' | 'discoveryHttp'): {
    targets: TrinnovProcessorTarget[];
    httpTargetsUrl?: string;
};
export declare function extractTrinnovTargetsFromHomebridgeConfig(rawConfig: unknown): TrinnovProcessorTarget[];
export declare class TrinnovTargetResolver {
    private readonly log;
    private readonly mode;
    private readonly platformHost?;
    private readonly platformPort;
    private readonly defaultStepDb;
    private readonly configuredDiscoveryUrl?;
    private readonly discoveryFilePath?;
    private readonly configPath?;
    private readonly httpFetcher;
    private fileTargets;
    private httpTargets;
    private configTargets;
    private discoveredHttpUrl?;
    private lastDiskCheckAt;
    private lastDiscoveryFileMtimeMs;
    private lastHttpFetchAt;
    private httpFetchInFlight;
    private refreshTimer;
    private lastLoggedTargetKey;
    constructor(options: TrinnovTargetResolverOptions, log: CecLogger);
    start(): void;
    stop(): void;
    refreshSync(): void;
    refreshHttp(): Promise<void>;
    resolveForAppleTv(params: {
        displayName: string;
        osdString: string;
        deviceOverride?: AppleTvTrinnovOverride;
    }): ResolvedTrinnovTarget | null;
    getCandidateList(): TrinnovProcessorTarget[];
    private selectBestCandidate;
    private logResolvedOnce;
    private maybeReloadDiscoveryFile;
    private loadDiscoveryFile;
    private loadHomebridgeConfig;
}
export interface TrinnovTcpClientOptions {
    host: string;
    port?: number;
    clientId?: string;
    idleTimeoutMs?: number;
    connectTimeoutMs?: number;
    socketFactory?: (port: number, host: string) => net.Socket;
}
export declare class TrinnovTcpClient {
    private readonly log;
    readonly host: string;
    readonly port: number;
    private readonly clientId;
    private readonly idleTimeoutMs;
    private readonly connectTimeoutMs;
    private readonly socketFactory;
    private socket;
    private state;
    private isStopped;
    private readBuffer;
    private idSent;
    private pendingCommands;
    private connectTimer;
    private welcomeFallbackTimer;
    private handshakeTimer;
    private idleTimer;
    private lastWarnAt;
    constructor(options: TrinnovTcpClientOptions, log: CecLogger);
    adjustVolume(deltaDb: number): void;
    toggleMute(): void;
    sendCommand(command: string): void;
    stop(): void;
    private connect;
    private handleData;
    private handleLine;
    private sendHandshakeId;
    private flushPendingCommands;
    private writeLine;
    private resetIdleTimer;
    private handleFailure;
    private cleanupSocket;
    private clearConnectTimer;
    private clearHandshakeTimers;
    private clearAllTimers;
}
export declare class TrinnovClientPool {
    private readonly options;
    private readonly log;
    private readonly clients;
    constructor(options: {
        clientId?: string;
        idleTimeoutMs?: number;
        connectTimeoutMs?: number;
        socketFactory?: (port: number, host: string) => net.Socket;
    }, log: CecLogger);
    adjustVolume(target: TrinnovProcessorTarget, deltaDb: number): void;
    toggleMute(target: TrinnovProcessorTarget): void;
    stopAll(): void;
    private getClient;
}
