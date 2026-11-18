import * as net from 'node:net';
import { CecLogger } from './cecClient';
export declare const TRINNOV_DEFAULT_PORT = 44100;
export type TargetAction = 'volumeUp' | 'volumeDown' | 'muteToggle' | 'powerOn' | 'powerOff' | 'powerToggle';
export type TargetDriverType = 'trinnov' | 'tcp' | 'http';
export type TargetMode = 'auto' | 'trinnov' | 'tcp' | 'http' | 'disabled';
export type TargetMuteAction = 'toggle' | 'ignore';
export interface ActionContext {
    stepDb?: number;
    isRepeat?: boolean;
    sourceName?: string;
    logicalAddress?: string;
}
export interface TargetDriver {
    readonly key: string;
    connect(): void;
    sendAction(action: TargetAction, context?: ActionContext): Promise<void> | void;
    disconnect(): void;
}
export interface TcpCommandTemplates {
    init?: string | string[];
    volumeUp?: string;
    volumeDown?: string;
    mute?: string;
    powerOn?: string;
    powerOff?: string;
    powerToggle?: string;
    bye?: string;
    lineEnding?: string;
    waitForBannerMs?: number;
    bannerIncludes?: string;
    handshakeExpect?: string;
}
export interface HttpEndpointDefinition {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
}
export interface HttpEndpointsConfig {
    volumeUp?: HttpEndpointDefinition | string;
    volumeDown?: HttpEndpointDefinition | string;
    mute?: HttpEndpointDefinition | string;
    powerOn?: HttpEndpointDefinition | string;
    powerOff?: HttpEndpointDefinition | string;
    powerToggle?: HttpEndpointDefinition | string;
}
export interface TargetSpec {
    id?: string;
    name?: string;
    plugin?: string;
    driver: TargetDriverType;
    host: string;
    port: number;
    volumeStepDb?: number;
    httpEndpoint?: string;
    tcpCommands?: TcpCommandTemplates;
    httpEndpoints?: HttpEndpointsConfig;
}
export declare const TRINNOV_TCP_PRESET: TcpCommandTemplates;
export declare const ANTHEM_TCP_PRESET: TcpCommandTemplates;
export declare const DENON_MARANTZ_TCP_PRESET: TcpCommandTemplates;
export declare const PIONEER_TCP_PRESET: TcpCommandTemplates;
export declare const STORMAUDIO_TCP_PRESET: TcpCommandTemplates;
export declare const LYNGDORF_TCP_PRESET: TcpCommandTemplates;
export declare const YAMAHA_HTTP_PRESET: HttpEndpointsConfig;
export interface BuiltInTargetPreset {
    id: string;
    driver: TargetDriverType;
    defaultPort: number;
    tcpCommands?: TcpCommandTemplates;
    httpEndpoints?: HttpEndpointsConfig;
}
export declare function matchBuiltInTargetPreset(hint: string): BuiltInTargetPreset | null;
export declare function normalizePort(rawPort: unknown, fallback?: number): number;
export interface TcpTargetDriverOptions {
    host: string;
    port?: number;
    driverLabel?: string;
    clientId?: string;
    idleTimeoutMs?: number;
    connectTimeoutMs?: number;
    commands?: TcpCommandTemplates;
    socketFactory?: (port: number, host: string) => net.Socket;
}
export declare class TcpTargetDriver implements TargetDriver {
    private readonly log;
    readonly key: string;
    readonly host: string;
    readonly port: number;
    private readonly driverLabel;
    private readonly clientId;
    private readonly idleTimeoutMs;
    private readonly connectTimeoutMs;
    private readonly commands;
    private readonly lineEnding;
    private readonly socketFactory;
    private socket;
    private state;
    private isStopped;
    private readBuffer;
    private initSent;
    private pendingPayloads;
    private connectTimer;
    private welcomeFallbackTimer;
    private handshakeTimer;
    private idleTimer;
    private lastWarnAt;
    constructor(options: TcpTargetDriverOptions, log: CecLogger);
    connect(): void;
    sendAction(action: TargetAction, context?: ActionContext): void;
    sendRawLine(line: string): void;
    disconnect(): void;
    private resolveActionTemplate;
    private getInitCommands;
    private renderByePayload;
    private enqueueOrWritePayload;
    private handleData;
    private handleLine;
    private sendInitCommands;
    private flushPendingPayloads;
    private writePayload;
    private resetIdleTimer;
    private handleFailure;
    private cleanupSocket;
    private clearConnectTimer;
    private clearHandshakeTimers;
    private clearAllTimers;
}
export type HttpFetchFn = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
}>;
export interface HttpTargetDriverOptions {
    host?: string;
    port?: number;
    baseUrl?: string;
    endpoints?: HttpEndpointsConfig;
    requestTimeoutMs?: number;
    fetcher?: HttpFetchFn;
}
export declare class HttpTargetDriver implements TargetDriver {
    private readonly log;
    readonly key: string;
    private readonly baseUrl?;
    private readonly endpoints;
    private readonly requestTimeoutMs;
    private readonly fetcher;
    private lastWarnAt;
    constructor(options: HttpTargetDriverOptions, log: CecLogger);
    connect(): void;
    sendAction(action: TargetAction, context?: ActionContext): Promise<void>;
    disconnect(): void;
    private resolveEndpoint;
    private resolveUrl;
    private warnThrottled;
}
export declare class TargetDriverPool {
    private readonly options;
    private readonly log;
    private readonly drivers;
    constructor(options: {
        clientId?: string;
        idleTimeoutMs?: number;
        connectTimeoutMs?: number;
        requestTimeoutMs?: number;
        tcpCommands?: TcpCommandTemplates;
        httpEndpoints?: HttpEndpointsConfig;
        socketFactory?: (port: number, host: string) => net.Socket;
        httpFetcher?: HttpFetchFn;
    }, log: CecLogger);
    sendAction(target: TargetSpec, action: TargetAction, context?: ActionContext): void;
    stopAll(): void;
    private getDriver;
}
