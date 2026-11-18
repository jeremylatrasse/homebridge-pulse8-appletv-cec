import { CecLogger } from './cecClient';
import { HttpEndpointsConfig, TargetDriverType, TargetMode, TargetSpec, TcpCommandTemplates } from './targetDriver';
export declare const GENERIC_DISCOVERY_FILENAME = "homebridge-cec-targets.json";
export declare const TRINNOV_DISCOVERY_FILENAME = "homebridge-trinnov-discovery.json";
export type TargetSource = 'deviceConfig' | 'platformConfig' | 'discoveryHttp' | 'discoveryFile' | 'homebridgeConfig';
export interface DiscoveredTarget extends TargetSpec {
    powered?: boolean;
    activeSource?: string;
    source: TargetSource;
}
export interface DiscoveryTargetEntry {
    id?: string;
    name?: string;
    driver?: string;
    host?: string;
    ip?: string;
    ipAddress?: string;
    address?: string;
    port?: number;
    powered?: boolean;
    activeSource?: string;
    volumeStepDb?: number;
    httpEndpoint?: string;
    tcpCommands?: TcpCommandTemplates;
    httpEndpoints?: HttpEndpointsConfig;
    enabled?: boolean;
}
export interface DiscoveryPayload {
    version?: number;
    plugin?: string;
    updatedAt?: string;
    pid?: number;
    http?: {
        baseUrl?: string;
        targetsPath?: string;
    };
    targets?: DiscoveryTargetEntry[];
    processors?: DiscoveryTargetEntry[];
    id?: string;
    name?: string;
    driver?: string;
    host?: string;
    ip?: string;
    port?: number;
    powered?: boolean;
    activeSource?: string;
    volumeStepDb?: number;
    httpEndpoint?: string;
}
export interface AppleTvTargetOverride {
    targetEnabled?: boolean;
    targetId?: string;
    targetDriver?: TargetDriverType;
    targetHost?: string;
    targetPort?: number;
    tcpCommands?: TcpCommandTemplates;
    httpEndpoints?: HttpEndpointsConfig;
    trinnovEnabled?: boolean;
    trinnovId?: string;
    trinnovHost?: string;
    trinnovPort?: number;
    volumeStepDb?: number;
}
export interface TargetResolverOptions {
    mode?: TargetMode;
    host?: string;
    port?: number;
    volumeStepDb?: number;
    discoveryUrl?: string;
    storagePath?: string;
    configPath?: string;
    autodetectPlugins?: string[];
    tcpCommands?: TcpCommandTemplates;
    httpEndpoints?: HttpEndpointsConfig;
    httpFetcher?: (url: string, timeoutMs: number) => Promise<string>;
}
export interface ResolvedTarget {
    target: DiscoveredTarget;
    stepDb: number;
}
export declare function parseDiscoveryPayload(raw: unknown, source: 'discoveryFile' | 'discoveryHttp'): {
    targets: DiscoveredTarget[];
    httpTargetsUrl?: string;
};
export declare function extractTargetsFromHomebridgeConfig(rawConfig: unknown, options?: {
    autodetectPlugins?: string[];
}): DiscoveredTarget[];
export declare class TargetResolver {
    private readonly log;
    private readonly mode;
    private readonly platformHost?;
    private readonly platformPort?;
    private readonly defaultStepDb;
    private readonly configuredDiscoveryUrl?;
    private readonly storagePath?;
    private readonly configPath?;
    private readonly autodetectPlugins?;
    private readonly platformTcpCommands?;
    private readonly platformHttpEndpoints?;
    private readonly httpFetcher;
    private fileTargets;
    private httpTargets;
    private configTargets;
    private discoveredHttpUrl?;
    private lastDiskCheckAt;
    private lastFileMtimes;
    private lastHttpFetchAt;
    private httpFetchInFlight;
    private refreshTimer;
    private lastLoggedTargetKey;
    constructor(options: TargetResolverOptions, log: CecLogger);
    start(): void;
    stop(): void;
    refreshSync(): void;
    refreshHttp(): Promise<void>;
    resolveForAppleTv(params: {
        displayName: string;
        osdString: string;
        deviceOverride?: AppleTvTargetOverride;
    }): ResolvedTarget | null;
    getCandidateList(): DiscoveredTarget[];
    private filterCandidatesByMode;
    private resolveExplicitDriver;
    private defaultPortForDriver;
    private applyOverrideCommands;
    private selectBestCandidate;
    private logResolvedOnce;
    private getDiscoveryFilePaths;
    private maybeReloadDiscoveryFiles;
    private loadDiscoveryFiles;
    private loadHomebridgeConfig;
}
