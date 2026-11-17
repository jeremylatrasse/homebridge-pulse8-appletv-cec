import { PlatformAccessory } from 'homebridge';
import { Pulse8AppleTvCecPlatform } from './platform';
import { CecDiscoveredDevice, CecKeyType, CecPressType } from './cecClient';
import { AppleTvTrinnovOverride } from './trinnovClient';
export interface AppleTvFilterConfig extends AppleTvTrinnovOverride {
    name?: string;
    id?: string;
    logicalAddress?: string;
    physicalAddress?: string;
    osdName?: string;
    enabled?: boolean;
}
export declare function sanitizeHomeKitName(rawName: string, fallback?: string): string;
/**
 * Exposes an Apple TV discovered via Pulse-Eight HDMI-CEC as a single HomeKit accessory
 * containing three StatelessProgrammableSwitch buttons:
 * 1. Volume Up (Single Press / Long Press)
 * 2. Volume Down (Single Press / Long Press)
 * 3. Mute (Single Press)
 */
export declare class Pulse8AppleTvAccessory {
    private readonly platform;
    private readonly accessory;
    readonly device: CecDiscoveredDevice;
    private readonly volumeUpService;
    private readonly volumeDownService;
    private readonly muteService;
    constructor(platform: Pulse8AppleTvCecPlatform, accessory: PlatformAccessory, device: CecDiscoveredDevice, displayName: string, pluginVersion: string);
    private ensureSwitchService;
    triggerKeyEvent(key: CecKeyType, pressType: CecPressType): void;
}
