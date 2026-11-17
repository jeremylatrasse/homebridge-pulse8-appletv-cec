import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { CecDiscoveredDevice } from './cecClient';
import { AppleTvFilterConfig } from './platformAccessory';
export declare function matchesAppleTvFilter(device: CecDiscoveredDevice, filter: AppleTvFilterConfig): boolean;
export declare class Pulse8AppleTvCecPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: PlatformConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly accessories: PlatformAccessory[];
    private readonly activeByLogicalAddress;
    private readonly pluginVersion;
    private cecClient;
    private trinnovResolver;
    private trinnovPool;
    private trinnovMuteAction;
    private registeredPlatformName;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private getConfiguredDeviceFilters;
    private startCecBridge;
    private findEntryForLogicalAddress;
    private handleVolumeCommand;
    private reconcileDiscoveredAppleTvs;
}
