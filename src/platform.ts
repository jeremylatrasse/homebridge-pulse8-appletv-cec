import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import {
  CecActionEvent,
  CecDiscoveredDevice,
  CecHoldMode,
  CecKeyEvent,
  CecPowerChangeEvent,
  CecPowerKeyMode,
  Pulse8CecClient,
} from './cecClient';
import {
  AppleTvFilterConfig,
  PowerSensorType,
  Pulse8AppleTvAccessory,
  sanitizeHomeKitName,
} from './platformAccessory';
import { TargetResolver } from './targetDiscovery';
import {
  HttpEndpointsConfig,
  TargetDriverPool,
  TargetMode,
  TargetMuteAction,
  TcpCommandTemplates,
} from './targetDriver';

export type TargetPowerMode = 'none' | 'keysOnly' | 'all';

export interface NormalizedPlatformConfig {
  targetMode: TargetMode;
  targetHost?: string;
  targetPort?: number;
  targetVolumeStepDb?: number;
  targetMuteAction: TargetMuteAction;
  targetPowerMode: TargetPowerMode;
  targetDiscoveryUrl?: string;
  targetClientId?: string;
  targetIdleTimeoutMs?: number;
  targetAutodetectPlugins?: string[];
  tcpCommands?: TcpCommandTemplates;
  httpEndpoints?: HttpEndpointsConfig;
  powerSensorType: PowerSensorType;
  includePowerButtons: boolean;
  powerDebounceMs?: number;
  ignoreStandbyAfterWakeMs?: number;
  powerKeyMode: CecPowerKeyMode;
}

interface AccessoryContext {
  logicalAddress?: string;
  physicalAddress?: string;
  osdString?: string;
  portKey?: string;
}

interface ActiveAppleTvEntry {
  handler: Pulse8AppleTvAccessory;
  override?: AppleTvFilterConfig;
  displayName: string;
  osdString: string;
}

function loadPluginVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export function normalizePlatformConfig(config: PlatformConfig): NormalizedPlatformConfig {
  const rawMode = config.targetMode as string | undefined;
  let targetMode: TargetMode = 'auto';
  if (
    rawMode === 'trinnov' ||
    rawMode === 'tcp' ||
    rawMode === 'http' ||
    rawMode === 'disabled'
  ) {
    targetMode = rawMode;
  } else {
    const legacyMode = config.trinnovControl as string | undefined;
    if (legacyMode === 'enabled') {
      targetMode = 'trinnov';
    } else if (legacyMode === 'disabled') {
      targetMode = 'disabled';
    } else {
      targetMode = 'auto';
    }
  }

  const rawMute = (config.targetMuteAction ?? config.trinnovMuteAction) as string | undefined;
  const targetMuteAction: TargetMuteAction = rawMute === 'ignore' ? 'ignore' : 'toggle';

  const rawPowerMode = config.targetPowerMode as string | undefined;
  const targetPowerMode: TargetPowerMode =
    rawPowerMode === 'none' || rawPowerMode === 'all' ? rawPowerMode : 'keysOnly';

  const rawSensor = config.powerSensorType as string | undefined;
  const powerSensorType: PowerSensorType =
    rawSensor === 'occupancy' || rawSensor === 'switch' ? rawSensor : 'none';

  const powerKeyMode: CecPowerKeyMode = config.powerKeyMode === 'handle' ? 'handle' : 'ignore';

  const targetAutodetectPlugins = Array.isArray(config.targetAutodetectPlugins)
    ? (config.targetAutodetectPlugins as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )
    : undefined;

  return {
    targetMode,
    targetHost: (config.targetHost ?? config.trinnovHost) as string | undefined,
    targetPort: (config.targetPort ?? config.trinnovPort) as number | undefined,
    targetVolumeStepDb: (config.targetVolumeStepDb ?? config.trinnovVolumeStepDb) as number | undefined,
    targetMuteAction,
    targetPowerMode,
    targetDiscoveryUrl: (config.targetDiscoveryUrl ?? config.trinnovDiscoveryUrl) as string | undefined,
    targetClientId: (config.targetClientId ?? config.trinnovClientId) as string | undefined,
    targetIdleTimeoutMs: (config.targetIdleTimeoutMs ?? config.trinnovIdleTimeoutMs) as number | undefined,
    targetAutodetectPlugins,
    tcpCommands: config.tcpCommands as TcpCommandTemplates | undefined,
    httpEndpoints: config.httpEndpoints as HttpEndpointsConfig | undefined,
    powerSensorType,
    includePowerButtons: config.includePowerButtons === true,
    powerDebounceMs: config.powerDebounceMs as number | undefined,
    ignoreStandbyAfterWakeMs: config.ignoreStandbyAfterWakeMs as number | undefined,
    powerKeyMode,
  };
}

export function matchesAppleTvFilter(
  device: CecDiscoveredDevice,
  filter: AppleTvFilterConfig,
): boolean {
  if (filter.logicalAddress && filter.logicalAddress.trim().toLowerCase() !== device.logicalAddress) {
    return false;
  }
  if (filter.physicalAddress && filter.physicalAddress.trim().toLowerCase() !== device.physicalAddress.toLowerCase()) {
    return false;
  }
  if (filter.osdName && filter.osdName.trim().toLowerCase() !== device.osdString.toLowerCase()) {
    return false;
  }
  return Boolean(filter.logicalAddress || filter.physicalAddress || filter.osdName);
}

export class Pulse8AppleTvCecPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly activeByLogicalAddress = new Map<string, ActiveAppleTvEntry>();
  private readonly pluginVersion = loadPluginVersion();
  private cecClient: Pulse8CecClient | null = null;
  private targetResolver: TargetResolver | null = null;
  private driverPool: TargetDriverPool | null = null;
  private normalizedConfig: NormalizedPlatformConfig;
  private registeredPlatformName = PLATFORM_NAME;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.normalizedConfig = normalizePlatformConfig(this.config);
    this.registeredPlatformName = this.config.platform
      ? String(this.config.platform).split('.').pop() || PLATFORM_NAME
      : PLATFORM_NAME;

    this.log.info(
      `Initializing Pulse-Eight Apple TV CEC Platform v${this.pluginVersion}: "${this.config.name || 'Pulse-Eight Apple TV CEC'}"`,
    );

    this.api.on('didFinishLaunching', () => {
      this.startCecBridge();
    });

    this.api.on('shutdown', () => {
      if (this.cecClient) {
        this.cecClient.stop();
        this.cecClient = null;
      }
      if (this.targetResolver) {
        this.targetResolver.stop();
        this.targetResolver = null;
      }
      if (this.driverPool) {
        this.driverPool.stopAll();
        this.driverPool = null;
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private getConfiguredDeviceFilters(): AppleTvFilterConfig[] {
    return Array.isArray(this.config.devices)
      ? (this.config.devices as AppleTvFilterConfig[])
      : [];
  }

  private createAccessoryHandler(
    accessory: PlatformAccessory,
    device: CecDiscoveredDevice,
    displayName: string,
  ): Pulse8AppleTvAccessory {
    return new Pulse8AppleTvAccessory(
      this,
      accessory,
      device,
      displayName,
      this.pluginVersion,
      {
        powerSensorType: this.normalizedConfig.powerSensorType,
        includePowerButtons: this.normalizedConfig.includePowerButtons,
        initialPowerState: this.cecClient?.getBusPowerState(device.logicalAddress) ?? null,
        onPowerSwitchSet: (powered: boolean) => {
          if (this.normalizedConfig.targetPowerMode !== 'none') {
            this.dispatchTargetAction(
              device.logicalAddress,
              powered ? 'powerOn' : 'powerOff',
              false,
            );
          }
        },
      },
    );
  }

  private startCecBridge(): void {
    const cfg = this.normalizedConfig;

    const resolver = new TargetResolver(
      {
        mode: cfg.targetMode,
        host: cfg.targetHost,
        port: cfg.targetPort,
        volumeStepDb: cfg.targetVolumeStepDb,
        discoveryUrl: cfg.targetDiscoveryUrl,
        storagePath: this.api.user.storagePath(),
        configPath: this.api.user.configPath(),
        autodetectPlugins: cfg.targetAutodetectPlugins,
        tcpCommands: cfg.tcpCommands,
        httpEndpoints: cfg.httpEndpoints,
      },
      this.log,
    );
    resolver.start();
    this.targetResolver = resolver;

    const initialCandidates = resolver.getCandidateList();
    if (cfg.targetHost) {
      this.log.info(
        `[Target] Configured direct target (${cfg.targetMode}): ${cfg.targetHost}${cfg.targetPort ? `:${cfg.targetPort}` : ''}`,
      );
    } else if (initialCandidates.length > 0) {
      const summary = initialCandidates
        .map((c) => `${c.name || c.id || c.driver} [${c.driver}] (${c.host}:${c.port} via ${c.source})`)
        .join(', ');
      this.log.info(`[Target] Auto-discovered target(s): ${summary}`);
    } else if (cfg.targetMode !== 'disabled') {
      this.log.info(
        '[Target] No external target discovered yet; watching Homebridge storagePath/config for discovery files (HomeKit buttons remain active).',
      );
    }

    this.driverPool = new TargetDriverPool(
      {
        clientId: cfg.targetClientId,
        idleTimeoutMs: cfg.targetIdleTimeoutMs,
        tcpCommands: cfg.tcpCommands,
        httpEndpoints: cfg.httpEndpoints,
      },
      this.log,
    );

    const activeFilters = this.getConfiguredDeviceFilters().filter((f) => f.enabled !== false);

    // Rehydrate cached accessories immediately so buttons remain wired if traffic arrives before scan finishes
    for (const cached of this.accessories) {
      const ctx = (cached.context || {}) as AccessoryContext;
      if (ctx.logicalAddress) {
        const placeholderDevice: CecDiscoveredDevice = {
          logicalAddress: ctx.logicalAddress,
          logicalAddressNum: parseInt(ctx.logicalAddress, 16) || 4,
          deviceType: 'Playback',
          physicalAddress: ctx.physicalAddress || '',
          activeSource: false,
          vendor: 'Apple',
          osdString: ctx.osdString || cached.displayName,
          isAppleTv: true,
        };
        const handler = this.createAccessoryHandler(cached, placeholderDevice, cached.displayName);
        const matchingOverride = activeFilters.find((f) =>
          matchesAppleTvFilter(placeholderDevice, f),
        );
        this.activeByLogicalAddress.set(ctx.logicalAddress, {
          handler,
          override: matchingOverride,
          displayName: cached.displayName,
          osdString: placeholderDevice.osdString,
        });
      }
    }

    const client = new Pulse8CecClient(
      {
        cecClientPath: this.config.cecClientPath as string | undefined,
        portPath: this.config.portPath as string | undefined,
        osdName: this.config.osdName as string | undefined,
        hdmiPort: this.config.hdmiPort as number | undefined,
        holdMode: (this.config.holdMode as CecHoldMode | undefined) || 'longPress',
        holdDelayMs: this.config.holdDelayMs as number | undefined,
        holdRepeatMs: this.config.holdRepeatMs as number | undefined,
        holdSafetyMs: this.config.holdSafetyMs as number | undefined,
        powerDebounceMs: cfg.powerDebounceMs,
        ignoreStandbyAfterWakeMs: cfg.ignoreStandbyAfterWakeMs,
        powerKeyMode: cfg.powerKeyMode,
        rescanIntervalSec: this.config.rescanIntervalSec as number | undefined,
      },
      this.log,
    );

    client.on('scanResult', ({ appleTvs }: { devices: CecDiscoveredDevice[]; appleTvs: CecDiscoveredDevice[] }) => {
      this.reconcileDiscoveredAppleTvs(appleTvs);
    });

    client.on('keyPress', (event: CecKeyEvent) => {
      const entry = this.findEntryForLogicalAddress(event.logicalAddress);
      if (entry) {
        entry.handler.triggerKeyEvent(event.key, event.pressType);
      }
    });

    client.on('powerChange', (event: CecPowerChangeEvent) => {
      const entry = this.findEntryForLogicalAddress(event.logicalAddress);
      if (entry) {
        entry.handler.setPowerState(event.powered);
        if (this.normalizedConfig.includePowerButtons && event.source === 'bus') {
          entry.handler.triggerKeyEvent(event.powered ? 'powerOn' : 'powerOff', 'single');
        }
      }
    });

    client.on('action', (event: CecActionEvent) => {
      this.handleSemanticAction(event);
    });

    this.cecClient = client;
    client.start();
  }

  private findEntryForLogicalAddress(logicalAddress: string): ActiveAppleTvEntry | undefined {
    const exact = this.activeByLogicalAddress.get(logicalAddress);
    if (exact) {
      return exact;
    }
    // Fallback if traffic arrived before scan completed and only 1 cached accessory exists
    if (this.activeByLogicalAddress.size === 1) {
      return Array.from(this.activeByLogicalAddress.values())[0];
    }
    return undefined;
  }

  private handleSemanticAction(event: CecActionEvent): void {
    const cfg = this.normalizedConfig;
    if (event.action === 'muteToggle' && cfg.targetMuteAction === 'ignore') {
      return;
    }

    if (
      event.action === 'powerOn' ||
      event.action === 'powerOff' ||
      event.action === 'powerToggle'
    ) {
      if (cfg.targetPowerMode === 'none') {
        return;
      }
      if (cfg.targetPowerMode === 'keysOnly' && event.source !== 'key') {
        return;
      }
    }

    this.dispatchTargetAction(event.logicalAddress, event.action, event.isRepeat);
  }

  private dispatchTargetAction(
    logicalAddress: string,
    action: CecActionEvent['action'],
    isRepeat: boolean,
  ): void {
    if (!this.targetResolver || !this.driverPool) {
      return;
    }

    const entry = this.findEntryForLogicalAddress(logicalAddress);
    const resolved = this.targetResolver.resolveForAppleTv({
      displayName: entry?.displayName || 'Apple TV',
      osdString: entry?.osdString || 'Apple TV',
      deviceOverride: entry?.override,
    });
    if (!resolved) {
      return;
    }

    this.driverPool.sendAction(resolved.target, action, {
      stepDb: resolved.stepDb,
      isRepeat,
      sourceName: entry?.displayName || entry?.osdString || 'Apple TV',
      logicalAddress,
    });
  }

  private reconcileDiscoveredAppleTvs(discoveredAppleTvs: CecDiscoveredDevice[]): void {
    if (discoveredAppleTvs.length === 0) {
      // Do not purge cached accessories if scan found nothing (e.g. Apple TV asleep or adapter still initializing)
      return;
    }

    const filters = this.getConfiguredDeviceFilters();
    const activeFilters = filters.filter((f) => f.enabled !== false);
    const disabledFilters = filters.filter((f) => f.enabled === false);

    // Determine which discovered Apple TVs should be exposed
    const selected: Array<{ device: CecDiscoveredDevice; override?: AppleTvFilterConfig }> = [];

    for (const device of discoveredAppleTvs) {
      const isDisabled = disabledFilters.some((f) => matchesAppleTvFilter(device, f));
      if (isDisabled) {
        this.log.info(
          `[CEC] Skipping Apple TV (${device.osdString || 'Apple TV'}, logical=${device.logicalAddress}) because it is disabled in config.`,
        );
        continue;
      }

      const matchingOverride = activeFilters.find((f) => matchesAppleTvFilter(device, f));
      if (activeFilters.length > 0 && !matchingOverride) {
        this.log.info(
          `[CEC] Skipping Apple TV (${device.osdString || 'Apple TV'}, logical=${device.logicalAddress}) because it does not match configured device filters.`,
        );
        continue;
      }

      selected.push({ device, override: matchingOverride });
    }

    const portKey = (this.config.portPath as string | undefined)?.trim() || 'auto';
    const osdCounts = new Map<string, number>();
    for (const item of selected) {
      const base = (item.override?.name?.trim() || item.device.osdString || 'Apple TV').toLowerCase();
      osdCounts.set(base, (osdCounts.get(base) ?? 0) + 1);
    }

    const activeUUIDs = new Set<string>();
    this.activeByLogicalAddress.clear();

    for (const { device, override } of selected) {
      const rawBaseName = override?.name?.trim() || device.osdString || 'Apple TV';
      const hasDuplicateName = (osdCounts.get(rawBaseName.toLowerCase()) ?? 0) > 1;
      const disambiguatedName = hasDuplicateName
        ? `${rawBaseName} ${device.physicalAddress || device.logicalAddress.toUpperCase()}`
        : rawBaseName;
      const displayName = sanitizeHomeKitName(disambiguatedName, 'Apple TV');

      const uuidSeed = override?.id?.trim()
        ? `pulse8-appletv-cec:${override.id.trim()}`
        : `pulse8-appletv-cec:${portKey}:${device.logicalAddress}:${device.physicalAddress || 'unknown'}`;
      const uuid = this.api.hap.uuid.generate(uuidSeed);
      activeUUIDs.add(uuid);

      const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
      if (existingAccessory) {
        this.log.info(
          `Restoring Apple TV CEC accessory: "${displayName}" (logical=${device.logicalAddress}, physical=${device.physicalAddress || 'unknown'})`,
        );
        existingAccessory.displayName = displayName;
        existingAccessory.context = {
          logicalAddress: device.logicalAddress,
          physicalAddress: device.physicalAddress,
          osdString: device.osdString,
          portKey,
        } satisfies AccessoryContext;
        const handler = this.createAccessoryHandler(existingAccessory, device, displayName);
        this.activeByLogicalAddress.set(device.logicalAddress, {
          handler,
          override,
          displayName,
          osdString: device.osdString,
        });
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        this.log.info(
          `Registering new Apple TV CEC accessory: "${displayName}" (logical=${device.logicalAddress}, physical=${device.physicalAddress || 'unknown'})`,
        );
        const accessory = new this.api.platformAccessory(displayName, uuid);
        accessory.context = {
          logicalAddress: device.logicalAddress,
          physicalAddress: device.physicalAddress,
          osdString: device.osdString,
          portKey,
        } satisfies AccessoryContext;
        const handler = this.createAccessoryHandler(accessory, device, displayName);
        this.activeByLogicalAddress.set(device.logicalAddress, {
          handler,
          override,
          displayName,
          osdString: device.osdString,
        });
        this.api.registerPlatformAccessories(PLUGIN_NAME, this.registeredPlatformName, [accessory]);
        this.accessories.push(accessory);
      }
    }

    // Remove stale cached accessories that are no longer selected
    const staleAccessories = this.accessories.filter((acc) => !activeUUIDs.has(acc.UUID));
    if (staleAccessories.length > 0) {
      this.log.info(`Cleaning up ${staleAccessories.length} stale accessory/accessories from cache.`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, this.registeredPlatformName, staleAccessories);
      for (const stale of staleAccessories) {
        const idx = this.accessories.indexOf(stale);
        if (idx !== -1) {
          this.accessories.splice(idx, 1);
        }
      }
    }
  }
}
