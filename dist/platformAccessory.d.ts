import { PlatformAccessory } from 'homebridge';
import { Pulse8AppleTvCecPlatform } from './platform';
import { CecDiscoveredDevice, CecKeyType, CecPressType } from './cecClient';
import { AppleTvTargetOverride } from './targetDiscovery';
export type PowerSensorType = 'none' | 'occupancy' | 'switch';
export interface AppleTvFilterConfig extends AppleTvTargetOverride {
    name?: string;
    id?: string;
    logicalAddress?: string;
    physicalAddress?: string;
    osdName?: string;
    enabled?: boolean;
}
export interface AppleTvAccessoryOptions {
    powerSensorType?: PowerSensorType;
    includePowerButtons?: boolean;
    initialPowerState?: boolean | null;
    onPowerSwitchSet?: (powered: boolean) => void;
}
export declare function sanitizeHomeKitName(rawName: string, fallback?: string): string;
/**
 * Exposes an Apple TV discovered via Pulse-Eight HDMI-CEC as a single HomeKit accessory
 * containing StatelessProgrammableSwitch buttons (Volume Up, Volume Down, Mute, and optional
 * Power On / Power Off) plus an optional OccupancySensor or Switch tracking CEC power state.
 */
export declare class Pulse8AppleTvAccessory {
    private readonly platform;
    private readonly accessory;
    readonly device: CecDiscoveredDevice;
    private readonly volumeUpService;
    private readonly volumeDownService;
    private readonly muteService;
    private readonly powerOnService;
    private readonly powerOffService;
    private readonly occupancyService;
    private readonly powerSwitchService;
    private currentPowerState;
    constructor(platform: Pulse8AppleTvCecPlatform, accessory: PlatformAccessory, device: CecDiscoveredDevice, displayName: string, pluginVersion: string, options?: AppleTvAccessoryOptions);
    private removeServiceIfPresent;
    private ensureSwitchService;
    private ensureOccupancyService;
    private ensurePowerSwitchService;
    setPowerState(powered: boolean): void;
    triggerKeyEvent(key: CecKeyType, pressType: CecPressType): void;
}
