import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { join } from 'node:path';
import { CecLogger } from './cecClient';
import {
  HttpEndpointsConfig,
  matchBuiltInTargetPreset,
  normalizePort,
  TargetDriverType,
  TargetMode,
  TargetSpec,
  TcpCommandTemplates,
  TRINNOV_DEFAULT_PORT,
} from './targetDriver';

export const GENERIC_DISCOVERY_FILENAME = 'homebridge-cec-targets.json';
export const TRINNOV_DISCOVERY_FILENAME = 'homebridge-trinnov-discovery.json';

export type TargetSource =
  | 'deviceConfig'
  | 'platformConfig'
  | 'discoveryHttp'
  | 'discoveryFile'
  | 'homebridgeConfig';

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
  // Simplified single-target fallback
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
  // New generalized keys
  targetEnabled?: boolean;
  targetId?: string;
  targetDriver?: TargetDriverType;
  targetHost?: string;
  targetPort?: number;
  tcpCommands?: TcpCommandTemplates;
  httpEndpoints?: HttpEndpointsConfig;
  // Legacy Trinnov aliases
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

const GENERIC_AV_PLUGIN_KEYWORDS = [
  'avr',
  'receiver',
  'amplifier',
  'preamp',
  'processor',
  'soundbar',
  'sonos',
  'onkyo',
  'integra',
  'arcam',
  'emotiva',
  'nad',
  'rotel',
  'mcintosh',
  'lexicon',
  'datasat',
  'synthesis',
  'webos',
  'bravia',
  'tizen',
  'vizio',
  'roku',
  'bose',
];

function normalizeHost(entry: {
  host?: unknown;
  ip?: unknown;
  ipAddress?: unknown;
  address?: unknown;
  server?: unknown;
  url?: unknown;
}): string | null {
  for (const candidate of [
    entry.host,
    entry.ip,
    entry.ipAddress,
    entry.address,
    entry.server,
  ]) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  if (typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url.trim())) {
    try {
      const parsed = new URL(entry.url.trim());
      if (parsed.hostname) {
        return parsed.hostname;
      }
    } catch {
      // Ignore invalid URL
    }
  }
  return null;
}

function normalizeStepDb(rawStep: unknown): number | undefined {
  if (typeof rawStep === 'number' && Number.isFinite(rawStep) && rawStep > 0 && rawStep <= 10) {
    return rawStep;
  }
  return undefined;
}

function normalizeString(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function normalizeDriverType(rawDriver: unknown): TargetDriverType | undefined {
  if (typeof rawDriver !== 'string') {
    return undefined;
  }
  const lower = rawDriver.trim().toLowerCase();
  if (lower === 'trinnov' || lower === 'tcp' || lower === 'http') {
    return lower;
  }
  return undefined;
}

function inferDriverType(params: {
  explicitDriver?: unknown;
  plugin?: string;
  port?: unknown;
  httpEndpoint?: string;
  httpEndpoints?: HttpEndpointsConfig;
  tcpCommands?: TcpCommandTemplates;
}): TargetDriverType {
  const explicit = normalizeDriverType(params.explicitDriver);
  if (explicit) {
    return explicit;
  }

  const pluginLower = params.plugin?.toLowerCase() ?? '';
  if (pluginLower.includes('trinnov')) {
    return 'trinnov';
  }

  if (params.httpEndpoints && !params.tcpCommands) {
    return 'http';
  }

  const numericPort = normalizePort(params.port, 0);
  if (numericPort === TRINNOV_DEFAULT_PORT) {
    return 'trinnov';
  }

  if (params.tcpCommands) {
    return 'tcp';
  }

  if (params.httpEndpoint && numericPort === 0) {
    return 'http';
  }

  return numericPort === 0 ? 'trinnov' : 'tcp';
}

function hasAnyHttpEndpoint(endpoints?: HttpEndpointsConfig): boolean {
  if (!endpoints) {
    return false;
  }
  return Boolean(
    endpoints.volumeUp ||
      endpoints.volumeDown ||
      endpoints.mute ||
      endpoints.powerOn ||
      endpoints.powerOff ||
      endpoints.powerToggle,
  );
}

function hasAnyTcpCommand(commands?: TcpCommandTemplates): boolean {
  if (!commands) {
    return false;
  }
  return Boolean(
    commands.volumeUp ||
      commands.volumeDown ||
      commands.mute ||
      commands.powerOn ||
      commands.powerOff ||
      commands.powerToggle,
  );
}

function hasActionableCommands(target: TargetSpec): boolean {
  if (target.driver === 'trinnov') {
    return true;
  }
  if (target.driver === 'http') {
    return hasAnyHttpEndpoint(target.httpEndpoints);
  }
  return hasAnyTcpCommand(target.tcpCommands);
}

export function parseDiscoveryPayload(
  raw: unknown,
  source: 'discoveryFile' | 'discoveryHttp',
): { targets: DiscoveredTarget[]; httpTargetsUrl?: string } {
  if (!raw || typeof raw !== 'object') {
    return { targets: [] };
  }

  const payload = raw as DiscoveryPayload;
  const plugin = normalizeString(payload.plugin);
  const targets: DiscoveredTarget[] = [];

  const entries = Array.isArray(payload.targets)
    ? payload.targets
    : Array.isArray(payload.processors)
      ? payload.processors
      : null;

  if (entries) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || entry.enabled === false) {
        continue;
      }
      const host = normalizeHost(entry);
      if (!host) {
        continue;
      }
      const httpEndpoint = normalizeString(entry.httpEndpoint);
      const driver = inferDriverType({
        explicitDriver: entry.driver,
        plugin,
        port: entry.port,
        httpEndpoint,
        httpEndpoints: entry.httpEndpoints,
        tcpCommands: entry.tcpCommands,
      });
      const defaultPort = driver === 'http' ? 80 : driver === 'trinnov' ? TRINNOV_DEFAULT_PORT : 23;
      targets.push({
        id: normalizeString(entry.id),
        name: normalizeString(entry.name),
        plugin,
        driver,
        host,
        port: normalizePort(entry.port, defaultPort),
        powered: typeof entry.powered === 'boolean' ? entry.powered : undefined,
        activeSource: normalizeString(entry.activeSource),
        volumeStepDb: normalizeStepDb(entry.volumeStepDb),
        httpEndpoint,
        tcpCommands: entry.tcpCommands,
        httpEndpoints: entry.httpEndpoints,
        source,
      });
    }
  } else {
    const host = normalizeHost(payload);
    if (host) {
      const httpEndpoint = normalizeString(payload.httpEndpoint);
      const driver = inferDriverType({
        explicitDriver: payload.driver,
        plugin,
        port: payload.port,
        httpEndpoint,
      });
      const defaultPort = driver === 'http' ? 80 : driver === 'trinnov' ? TRINNOV_DEFAULT_PORT : 23;
      targets.push({
        id: normalizeString(payload.id),
        name: normalizeString(payload.name),
        plugin,
        driver,
        host,
        port: normalizePort(payload.port, defaultPort),
        powered: typeof payload.powered === 'boolean' ? payload.powered : undefined,
        activeSource: normalizeString(payload.activeSource),
        volumeStepDb: normalizeStepDb(payload.volumeStepDb),
        httpEndpoint,
        source,
      });
    }
  }

  let httpTargetsUrl: string | undefined;
  if (payload.http && typeof payload.http.baseUrl === 'string' && payload.http.baseUrl.trim()) {
    const base = payload.http.baseUrl.trim().replace(/\/+$/, '');
    const path =
      typeof payload.http.targetsPath === 'string' && payload.http.targetsPath.trim()
        ? payload.http.targetsPath.trim()
        : '/api/cec/targets';
    httpTargetsUrl = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  return { targets, httpTargetsUrl };
}

function extractTargetsFromConfigObject(
  entry: Record<string, unknown>,
  defaults: {
    driver: TargetDriverType;
    defaultPort: number;
    pluginHint?: string;
    tcpCommands?: TcpCommandTemplates;
    httpEndpoints?: HttpEndpointsConfig;
  },
  targets: DiscoveredTarget[],
  seenKeys: Set<string>,
): void {
  if (entry.enabled === false) {
    return;
  }

  const pushEntry = (item: Record<string, unknown>, fallbackName?: string) => {
    if (item.enabled === false) {
      return;
    }

    const cecMeta =
      item.cecTarget && typeof item.cecTarget === 'object'
        ? (item.cecTarget as Record<string, unknown>)
        : undefined;

    const itemTcp =
      (cecMeta?.tcpCommands as TcpCommandTemplates | undefined) ??
      (item.tcpCommands as TcpCommandTemplates | undefined) ??
      defaults.tcpCommands;
    const itemHttp =
      (cecMeta?.httpEndpoints as HttpEndpointsConfig | undefined) ??
      (item.httpEndpoints as HttpEndpointsConfig | undefined) ??
      defaults.httpEndpoints;

    const itemHint = [
      normalizeString(item.name),
      normalizeString(item.model),
      normalizeString(item.brand),
      normalizeString(item.type),
    ]
      .filter(Boolean)
      .join(' ');
    const itemPreset = itemHint ? matchBuiltInTargetPreset(itemHint) : null;

    const effectiveDriver =
      normalizeDriverType(cecMeta?.driver ?? item.driver) ??
      itemPreset?.driver ??
      defaults.driver;
    const effectiveDefaultPort =
      itemPreset?.defaultPort ??
      (effectiveDriver === 'http'
        ? 80
        : effectiveDriver === 'trinnov'
          ? TRINNOV_DEFAULT_PORT
          : defaults.defaultPort);

    const host = normalizeHost(item);
    const urlStr = normalizeString(item.url);
    if (!host && !(effectiveDriver === 'http' && hasAnyHttpEndpoint(itemHttp))) {
      return;
    }

    const effectiveHost = host || 'webhook';
    const port = normalizePort(cecMeta?.port ?? item.port, effectiveDefaultPort);
    const key = `${effectiveDriver}:${effectiveHost.toLowerCase()}:${port}`;
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    let httpEndpoint: string | undefined;
    if (effectiveDriver === 'http' && urlStr && /^https?:\/\//i.test(urlStr)) {
      try {
        const parsed = new URL(urlStr);
        httpEndpoint = `${parsed.protocol}//${parsed.host}`;
      } catch {
        // Ignore invalid URL
      }
    }

    targets.push({
      id: normalizeString(cecMeta?.id ?? item.id),
      name: normalizeString(item.name) || fallbackName,
      plugin: defaults.pluginHint,
      driver: effectiveDriver,
      host: effectiveHost,
      port,
      volumeStepDb: normalizeStepDb(cecMeta?.volumeStepDb ?? item.volumeStepDb),
      httpEndpoint,
      tcpCommands: itemPreset?.tcpCommands ?? itemTcp,
      httpEndpoints: itemPreset?.httpEndpoints ?? itemHttp,
      source: 'homebridgeConfig',
    });
  };

  pushEntry(entry);

  for (const arrayKey of [
    'devices',
    'processors',
    'amplifiers',
    'receivers',
    'zones',
    'targets',
    'speakers',
    'tvs',
  ]) {
    const nested = entry[arrayKey];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (item && typeof item === 'object') {
          pushEntry(item as Record<string, unknown>, normalizeString(entry.name));
        }
      }
    }
  }
}

export function extractTargetsFromHomebridgeConfig(
  rawConfig: unknown,
  options: { autodetectPlugins?: string[] } = {},
): DiscoveredTarget[] {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return [];
  }

  const config = rawConfig as {
    platforms?: unknown[];
    accessories?: unknown[];
  };
  const targets: DiscoveredTarget[] = [];
  const seenKeys = new Set<string>();
  const extraMatchers = (options.autodetectPlugins ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const inspectEntry = (rawEntry: unknown, kind: 'platform' | 'accessory') => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      return;
    }
    const entry = rawEntry as Record<string, unknown>;
    const identifier =
      kind === 'platform'
        ? normalizeString(entry.platform) || ''
        : normalizeString(entry.accessory) || '';
    const identifierLower = identifier.toLowerCase();

    // Never autodetect ourselves as a target
    if (
      identifierLower === 'pulse8appletvcec' ||
      identifierLower.includes('homebridge-pulse8-appletv-cec')
    ) {
      return;
    }

    const name = normalizeString(entry.name) || '';
    const hint = `${identifier} ${name}`.trim().toLowerCase();
    const hasExplicitCecTarget =
      entry.cecTarget === true ||
      Boolean(entry.cecTarget && typeof entry.cecTarget === 'object') ||
      Boolean(entry.tcpCommands) ||
      Boolean(entry.httpEndpoints);

    const preset = matchBuiltInTargetPreset(hint);
    const matchesGenericKeyword = GENERIC_AV_PLUGIN_KEYWORDS.some((kw) => hint.includes(kw));
    const matchesUserPlugin = extraMatchers.some((kw) => hint.includes(kw));

    if (!preset && !hasExplicitCecTarget && !matchesGenericKeyword && !matchesUserPlugin) {
      return;
    }

    const cecMeta =
      entry.cecTarget && typeof entry.cecTarget === 'object'
        ? (entry.cecTarget as Record<string, unknown>)
        : undefined;

    const explicitDriver = normalizeDriverType(cecMeta?.driver ?? entry.driver);
    const driver: TargetDriverType =
      explicitDriver ??
      preset?.driver ??
      (entry.httpEndpoints && !entry.tcpCommands ? 'http' : 'tcp');

    const defaultPort =
      preset?.defaultPort ??
      (driver === 'http' ? 80 : driver === 'trinnov' ? TRINNOV_DEFAULT_PORT : 23);

    extractTargetsFromConfigObject(
      entry,
      {
        driver,
        defaultPort,
        pluginHint: identifier || name || 'homebridge-config',
        tcpCommands:
          (cecMeta?.tcpCommands as TcpCommandTemplates | undefined) ??
          (entry.tcpCommands as TcpCommandTemplates | undefined) ??
          preset?.tcpCommands,
        httpEndpoints:
          (cecMeta?.httpEndpoints as HttpEndpointsConfig | undefined) ??
          (entry.httpEndpoints as HttpEndpointsConfig | undefined) ??
          preset?.httpEndpoints,
      },
      targets,
      seenKeys,
    );
  };

  if (Array.isArray(config.platforms)) {
    for (const platform of config.platforms) {
      inspectEntry(platform, 'platform');
    }
  }

  if (Array.isArray(config.accessories)) {
    for (const accessory of config.accessories) {
      inspectEntry(accessory, 'accessory');
    }
  }

  return targets;
}

function defaultHttpFetch(urlString: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(
      parsed,
      { timeout: timeoutMs },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

export class TargetResolver {
  private readonly mode: TargetMode;
  private readonly platformHost?: string;
  private readonly platformPort?: number;
  private readonly defaultStepDb: number;
  private readonly configuredDiscoveryUrl?: string;
  private readonly storagePath?: string;
  private readonly configPath?: string;
  private readonly autodetectPlugins?: string[];
  private readonly platformTcpCommands?: TcpCommandTemplates;
  private readonly platformHttpEndpoints?: HttpEndpointsConfig;
  private readonly httpFetcher: (url: string, timeoutMs: number) => Promise<string>;

  private fileTargets: DiscoveredTarget[] = [];
  private httpTargets: DiscoveredTarget[] = [];
  private configTargets: DiscoveredTarget[] = [];
  private discoveredHttpUrl?: string;

  private lastDiskCheckAt = 0;
  private lastFileMtimes = new Map<string, number>();
  private lastHttpFetchAt = 0;
  private httpFetchInFlight = false;
  private refreshTimer: NodeJS.Timeout | null = null;
  private lastLoggedTargetKey: string | null = null;

  constructor(
    options: TargetResolverOptions,
    private readonly log: CecLogger,
  ) {
    this.mode = options.mode ?? 'auto';
    this.platformHost = normalizeString(options.host);
    this.platformPort =
      typeof options.port === 'number' && options.port >= 1 && options.port <= 65535
        ? Math.floor(options.port)
        : undefined;
    this.defaultStepDb = normalizeStepDb(options.volumeStepDb) ?? 1;
    this.configuredDiscoveryUrl = normalizeString(options.discoveryUrl);
    this.storagePath = normalizeString(options.storagePath);
    this.configPath = normalizeString(options.configPath);
    this.autodetectPlugins = options.autodetectPlugins;
    this.platformTcpCommands = options.tcpCommands;
    this.platformHttpEndpoints = options.httpEndpoints;
    this.httpFetcher = options.httpFetcher ?? defaultHttpFetch;
  }

  public start(): void {
    if (this.mode === 'disabled') {
      this.log.info('[Target] Direct target control is disabled (HomeKit-only mode).');
      return;
    }

    this.refreshSync();
    void this.refreshHttp();

    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        this.refreshSync();
        void this.refreshHttp();
      }, 15000);
      this.refreshTimer.unref();
    }
  }

  public stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  public refreshSync(): void {
    this.lastDiskCheckAt = Date.now();
    this.loadDiscoveryFiles();
    this.loadHomebridgeConfig();
  }

  public async refreshHttp(): Promise<void> {
    if (this.mode === 'disabled' || this.httpFetchInFlight) {
      return;
    }
    const url = this.configuredDiscoveryUrl || this.discoveredHttpUrl;
    if (!url) {
      return;
    }

    this.httpFetchInFlight = true;
    this.lastHttpFetchAt = Date.now();
    try {
      const body = await this.httpFetcher(url, 1200);
      const parsed = JSON.parse(body) as unknown;
      const { targets } = parseDiscoveryPayload(parsed, 'discoveryHttp');
      if (targets.length > 0) {
        this.httpTargets = targets;
        this.log.debug(`[Target] HTTP discovery (${url}) returned ${targets.length} target(s).`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.debug(`[Target] HTTP discovery poll (${url}) unavailable: ${msg}`);
    } finally {
      this.httpFetchInFlight = false;
    }
  }

  public resolveForAppleTv(params: {
    displayName: string;
    osdString: string;
    deviceOverride?: AppleTvTargetOverride;
  }): ResolvedTarget | null {
    const override = params.deviceOverride;
    const isDeviceDisabled =
      override?.targetEnabled === false || override?.trinnovEnabled === false;

    if (this.mode === 'disabled' || isDeviceDisabled) {
      return null;
    }

    const stepDb = normalizeStepDb(override?.volumeStepDb) ?? this.defaultStepDb;

    // 1. Per-Apple TV explicit host / endpoints override
    const overrideHost = normalizeString(override?.targetHost) ?? normalizeString(override?.trinnovHost);
    const overridePort = override?.targetPort ?? override?.trinnovPort;
    if (overrideHost || hasAnyHttpEndpoint(override?.httpEndpoints)) {
      const driver = this.resolveExplicitDriver(
        override?.targetDriver,
        override?.tcpCommands,
        override?.httpEndpoints,
      );
      const defaultPort = this.defaultPortForDriver(driver);
      const target: DiscoveredTarget = {
        id: normalizeString(override?.targetId) ?? normalizeString(override?.trinnovId),
        name: params.displayName,
        driver,
        host: overrideHost || 'webhook',
        port: normalizePort(overridePort, defaultPort),
        volumeStepDb: stepDb,
        tcpCommands:
          this.platformTcpCommands || override?.tcpCommands
            ? { ...this.platformTcpCommands, ...override?.tcpCommands }
            : undefined,
        httpEndpoints:
          this.platformHttpEndpoints || override?.httpEndpoints
            ? { ...this.platformHttpEndpoints, ...override?.httpEndpoints }
            : undefined,
        source: 'deviceConfig',
      };
      this.logResolvedOnce(target);
      return { target, stepDb };
    }

    // Refresh disk discovery lightly if stale (> 2s)
    const now = Date.now();
    if (now - this.lastDiskCheckAt > 2000) {
      this.maybeReloadDiscoveryFiles();
    }
    if (now - this.lastHttpFetchAt > 10000) {
      void this.refreshHttp();
    }

    const candidates = this.filterCandidatesByMode(this.getCandidateList());

    // 2. Per-Apple TV targetId / trinnovId matched against discovered targets
    const requestedId = (
      normalizeString(override?.targetId) ?? normalizeString(override?.trinnovId)
    )?.toLowerCase();
    if (requestedId) {
      const matched = candidates.find(
        (c) =>
          c.id?.toLowerCase() === requestedId ||
          c.name?.toLowerCase() === requestedId,
      );
      if (matched) {
        const effectiveStep =
          normalizeStepDb(override?.volumeStepDb) ??
          matched.volumeStepDb ??
          this.defaultStepDb;
        const enriched = this.applyOverrideCommands(matched, override);
        this.logResolvedOnce(enriched);
        return { target: enriched, stepDb: effectiveStep };
      }
    }

    // 3. Platform-level explicit host or HTTP endpoints override
    if (this.platformHost || (this.mode === 'http' && hasAnyHttpEndpoint(this.platformHttpEndpoints))) {
      const driver = this.resolveExplicitDriver(
        undefined,
        this.platformTcpCommands,
        this.platformHttpEndpoints,
      );
      const defaultPort = this.defaultPortForDriver(driver);
      const target: DiscoveredTarget = {
        driver,
        host: this.platformHost || 'webhook',
        port: normalizePort(this.platformPort, defaultPort),
        volumeStepDb: stepDb,
        tcpCommands: this.platformTcpCommands,
        httpEndpoints: this.platformHttpEndpoints,
        source: 'platformConfig',
      };
      this.logResolvedOnce(target);
      return { target, stepDb };
    }

    // 4. Auto-discovered target (HTTP discovery -> discovery files -> Homebridge config.json)
    if (candidates.length === 0) {
      if (this.mode !== 'auto') {
        this.log.warn(
          `[Target] Target mode "${this.mode}" is active, but no compatible target was configured or discovered yet.`,
        );
      }
      return null;
    }

    const selected = this.selectBestCandidate(candidates, params.displayName, params.osdString);
    const effectiveStep =
      normalizeStepDb(override?.volumeStepDb) ??
      selected.volumeStepDb ??
      this.defaultStepDb;
    const enriched = this.applyOverrideCommands(selected, override);
    this.logResolvedOnce(enriched);
    return { target: enriched, stepDb: effectiveStep };
  }

  public getCandidateList(): DiscoveredTarget[] {
    if (this.httpTargets.length > 0) {
      return this.httpTargets;
    }
    if (this.fileTargets.length > 0) {
      return this.fileTargets;
    }
    return this.configTargets;
  }

  private filterCandidatesByMode(candidates: DiscoveredTarget[]): DiscoveredTarget[] {
    if (this.mode === 'auto') {
      return candidates;
    }
    return candidates.filter((c) => c.driver === this.mode);
  }

  private resolveExplicitDriver(
    overrideDriver?: TargetDriverType,
    tcpCommands?: TcpCommandTemplates,
    httpEndpoints?: HttpEndpointsConfig,
  ): TargetDriverType {
    if (overrideDriver) {
      return overrideDriver;
    }
    if (this.mode === 'tcp' || this.mode === 'http' || this.mode === 'trinnov') {
      return this.mode;
    }
    if (hasAnyHttpEndpoint(httpEndpoints ?? this.platformHttpEndpoints)) {
      return 'http';
    }
    if (hasAnyTcpCommand(tcpCommands ?? this.platformTcpCommands)) {
      return 'tcp';
    }
    return 'trinnov';
  }

  private defaultPortForDriver(driver: TargetDriverType): number {
    if (this.platformPort !== undefined) {
      return this.platformPort;
    }
    if (driver === 'trinnov') {
      return TRINNOV_DEFAULT_PORT;
    }
    if (driver === 'http') {
      return 80;
    }
    return 23;
  }

  private applyOverrideCommands(
    base: DiscoveredTarget,
    override?: AppleTvTargetOverride,
  ): DiscoveredTarget {
    const mergedTcp =
      base.tcpCommands || this.platformTcpCommands || override?.tcpCommands
        ? { ...base.tcpCommands, ...this.platformTcpCommands, ...override?.tcpCommands }
        : undefined;
    const mergedHttp =
      base.httpEndpoints || this.platformHttpEndpoints || override?.httpEndpoints
        ? { ...base.httpEndpoints, ...this.platformHttpEndpoints, ...override?.httpEndpoints }
        : undefined;

    if (!mergedTcp && !mergedHttp && !override?.targetDriver) {
      return base;
    }
    return {
      ...base,
      driver: override?.targetDriver ?? base.driver,
      tcpCommands: mergedTcp,
      httpEndpoints: mergedHttp,
    };
  }

  private selectBestCandidate(
    candidates: DiscoveredTarget[],
    displayName: string,
    osdString: string,
  ): DiscoveredTarget {
    if (candidates.length === 1) {
      return candidates[0];
    }

    const appleTvNames = [displayName, osdString]
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    // Prefer target whose activeSource matches this Apple TV's name
    for (const candidate of candidates) {
      const activeSrc = candidate.activeSource?.toLowerCase();
      if (!activeSrc) {
        continue;
      }
      if (appleTvNames.some((n) => activeSrc === n || activeSrc.includes(n) || n.includes(activeSrc))) {
        return candidate;
      }
    }

    // Prefer powered-on target
    const powered = candidates.find((c) => c.powered === true);
    if (powered) {
      return powered;
    }

    // Prefer targets that already have actionable commands/presets over generic commandless entries
    const actionable = candidates.find((c) => hasActionableCommands(c));
    if (actionable) {
      return actionable;
    }

    return candidates[0];
  }

  private logResolvedOnce(target: DiscoveredTarget): void {
    const key = `${target.driver}:${target.source}:${target.host}:${target.port}:${target.id || ''}`;
    if (this.lastLoggedTargetKey !== key) {
      this.lastLoggedTargetKey = key;
      this.log.info(
        `[Target] Routing CEC actions to [${target.driver}] ${target.host}:${target.port}` +
          `${target.name ? ` (${target.name})` : ''} via ${target.source}`,
      );
    }
  }

  private getDiscoveryFilePaths(): string[] {
    if (!this.storagePath) {
      return [];
    }
    const paths: string[] = [];
    const genericPath = join(this.storagePath, GENERIC_DISCOVERY_FILENAME);
    if (existsSync(genericPath)) {
      paths.push(genericPath);
    }

    try {
      const entries = readdirSync(this.storagePath)
        .filter((name) => /^homebridge-.*-discovery\.json$/i.test(name))
        .sort();
      for (const name of entries) {
        const fullPath = join(this.storagePath, name);
        if (!paths.includes(fullPath)) {
          paths.push(fullPath);
        }
      }
    } catch {
      // Ignore unreadable storagePath
    }
    return paths;
  }

  private maybeReloadDiscoveryFiles(): void {
    this.lastDiskCheckAt = Date.now();
    if (!this.storagePath) {
      return;
    }

    const currentPaths = this.getDiscoveryFilePaths();
    let changed = currentPaths.length !== this.lastFileMtimes.size;
    if (!changed) {
      for (const filePath of currentPaths) {
        try {
          const st = statSync(filePath);
          if (this.lastFileMtimes.get(filePath) !== st.mtimeMs) {
            changed = true;
            break;
          }
        } catch {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      this.loadDiscoveryFiles();
    }
  }

  private loadDiscoveryFiles(): void {
    if (!this.storagePath) {
      return;
    }

    const paths = this.getDiscoveryFilePaths();
    const nextMtimes = new Map<string, number>();
    const combinedTargets: DiscoveredTarget[] = [];
    const seenKeys = new Set<string>();
    let firstHttpUrl: string | undefined;

    for (const filePath of paths) {
      try {
        const st = statSync(filePath);
        if (!st.isFile()) {
          continue;
        }
        nextMtimes.set(filePath, st.mtimeMs);
        const content = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content) as unknown;
        const { targets, httpTargetsUrl } = parseDiscoveryPayload(parsed, 'discoveryFile');
        if (!firstHttpUrl && httpTargetsUrl) {
          firstHttpUrl = httpTargetsUrl;
        }
        for (const target of targets) {
          const dedupKey = `${target.driver}:${target.host.toLowerCase()}:${target.port}:${target.id || ''}`;
          if (!seenKeys.has(dedupKey)) {
            seenKeys.add(dedupKey);
            combinedTargets.push(target);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.debug(`[Target] Failed to read ${filePath}: ${msg}`);
      }
    }

    this.lastFileMtimes = nextMtimes;
    this.fileTargets = combinedTargets;
    this.discoveredHttpUrl = firstHttpUrl;
  }

  private loadHomebridgeConfig(): void {
    if (!this.configPath) {
      return;
    }
    try {
      if (!existsSync(this.configPath)) {
        return;
      }
      const content = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      this.configTargets = extractTargetsFromHomebridgeConfig(parsed, {
        autodetectPlugins: this.autodetectPlugins,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.debug(`[Target] Failed to read Homebridge config ${this.configPath}: ${msg}`);
    }
  }
}
