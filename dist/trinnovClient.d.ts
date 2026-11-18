import * as net from 'node:net';
import { CecLogger } from './cecClient';
import { AppleTvTargetOverride, TargetSource, TRINNOV_DISCOVERY_FILENAME } from './targetDiscovery';
import { TRINNOV_DEFAULT_PORT } from './targetDriver';
export { TRINNOV_DEFAULT_PORT, TRINNOV_DISCOVERY_FILENAME };
export type TrinnovControlMode = 'auto' | 'enabled' | 'disabled';
export type TrinnovMuteAction = 'toggle' | 'ignore';
export type TrinnovTargetSource = TargetSource;
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
export interface AppleTvTrinnovOverride extends AppleTvTargetOverride {
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
    private readonly inner;
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
    readonly host: string;
    readonly port: number;
    private readonly driver;
    constructor(options: TrinnovTcpClientOptions, log: CecLogger);
    adjustVolume(deltaDb: number): void;
    toggleMute(): void;
    sendCommand(command: string): void;
    stop(): void;
}
export declare class TrinnovClientPool {
    private readonly pool;
    constructor(options: {
        clientId?: string;
        idleTimeoutMs?: number;
        connectTimeoutMs?: number;
        socketFactory?: (port: number, host: string) => net.Socket;
    }, log: CecLogger);
    adjustVolume(target: TrinnovProcessorTarget, deltaDb: number): void;
    toggleMute(target: TrinnovProcessorTarget): void;
    stopAll(): void;
}
