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
  CecDiscoveredDevice,
  CecHoldMode,
  CecKeyEvent,
  CecVolumeCommandEvent,
  Pulse8CecClient,
} from './cecClient';
import {
  AppleTvFilterConfig,
  Pulse8AppleTvAccessory,
  sanitizeHomeKitName,
} from './platformAccessory';
import {
  TrinnovClientPool,
  TrinnovControlMode,
  TrinnovMuteAction,
  TrinnovTargetResolver,
} from './trinnovClient';

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
  private trinnovResolver: TrinnovTargetResolver | null = null;
  private trinnovPool: TrinnovClientPool | null = null;
  private trinnovMuteAction: TrinnovMuteAction = 'toggle';
  private registeredPlatformName = PLATFORM_NAME;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
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
      if (this.trinnovResolver) {
        this.trinnovResolver.stop();
        this.trinnovResolver = null;
      }
      if (this.trinnovPool) {
        this.trinnovPool.stopAll();
        this.trinnovPool = null;
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

  private startCecBridge(): void {
    const trinnovControlRaw = this.config.trinnovControl as string | undefined;
    const trinnovControl: TrinnovControlMode =
      trinnovControlRaw === 'enabled' || trinnovControlRaw === 'disabled'
        ? trinnovControlRaw
        : 'auto';
    this.trinnovMuteAction =
      this.config.trinnovMuteAction === 'ignore' ? 'ignore' : 'toggle';

    const resolver = new TrinnovTargetResolver(
      {
        mode: trinnovControl,
        host: this.config.trinnovHost as string | undefined,
        port: this.config.trinnovPort as number | undefined,
        volumeStepDb: this.config.trinnovVolumeStepDb as number | undefined,
        discoveryUrl: this.config.trinnovDiscoveryUrl as string | undefined,
        storagePath: this.api.user.storagePath(),
        configPath: this.api.user.configPath(),
      },
      this.log,
    );
    resolver.start();
    this.trinnovResolver = resolver;

    const initialCandidates = resolver.getCandidateList();
    if (this.config.trinnovHost) {
      this.log.info(
        `[Trinnov] Configured direct target: ${this.config.trinnovHost}:${(this.config.trinnovPort as number | undefined) ?? 44100}`,
      );
    } else if (initialCandidates.length > 0) {
      const summary = initialCandidates
        .map((c) => `${c.name || c.id || 'Trinnov'} (${c.host}:${c.port} via ${c.source})`)
        .join(', ');
      this.log.info(`[Trinnov] Auto-discovered target(s): ${summary}`);
    } else if (trinnovControl !== 'disabled') {
      this.log.info(
        '[Trinnov] No Trinnov target discovered yet; watching Homebridge storagePath/config for homebridge-trinnov.',
      );
    }

    this.trinnovPool = new TrinnovClientPool(
      {
        clientId: this.config.trinnovClientId as string | undefined,
        idleTimeoutMs: this.config.trinnovIdleTimeoutMs as number | undefined,
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
        const handler = new Pulse8AppleTvAccessory(
          this,
          cached,
          placeholderDevice,
          cached.displayName,
          this.pluginVersion,
        );
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

    client.on('volumeCommand', (event: CecVolumeCommandEvent) => {
      this.handleVolumeCommand(event);
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

  private handleVolumeCommand(event: CecVolumeCommandEvent): void {
    if (!this.trinnovResolver || !this.trinnovPool) {
      return;
    }

    const entry = this.findEntryForLogicalAddress(event.logicalAddress);
    const resolved = this.trinnovResolver.resolveForAppleTv({
      displayName: entry?.displayName || 'Apple TV',
      osdString: entry?.osdString || 'Apple TV',
      deviceOverride: entry?.override,
    });
    if (!resolved) {
      return;
    }

    if (event.key === 'volumeUp') {
      this.trinnovPool.adjustVolume(resolved.target, resolved.stepDb);
    } else if (event.key === 'volumeDown') {
      this.trinnovPool.adjustVolume(resolved.target, -resolved.stepDb);
    } else if (event.key === 'mute' && this.trinnovMuteAction !== 'ignore') {
      this.trinnovPool.toggleMute(resolved.target);
    }
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
        const handler = new Pulse8AppleTvAccessory(
          this,
          existingAccessory,
          device,
          displayName,
          this.pluginVersion,
        );
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
        const handler = new Pulse8AppleTvAccessory(
          this,
          accessory,
          device,
          displayName,
          this.pluginVersion,
        );
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
