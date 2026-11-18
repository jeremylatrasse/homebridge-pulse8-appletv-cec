import * as net from 'node:net';
import { CecLogger } from './cecClient';
import {
  AppleTvTargetOverride,
  DiscoveredTarget,
  extractTargetsFromHomebridgeConfig,
  parseDiscoveryPayload,
  TargetResolver,
  TargetSource,
  TRINNOV_DISCOVERY_FILENAME,
} from './targetDiscovery';
import {
  TargetDriverPool,
  TcpTargetDriver,
  TRINNOV_DEFAULT_PORT,
  TRINNOV_TCP_PRESET,
} from './targetDriver';

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

export interface AppleTvTrinnovOverride extends AppleTvTargetOverride {}

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

function toTrinnovTarget(target: DiscoveredTarget): TrinnovProcessorTarget {
  return {
    id: target.id,
    name: target.name,
    host: target.host,
    port: target.port,
    powered: target.powered,
    activeSource: target.activeSource,
    volumeStepDb: target.volumeStepDb,
    httpEndpoint: target.httpEndpoint,
    source: target.source,
  };
}

export function parseTrinnovDiscoveryPayload(
  raw: unknown,
  source: 'discoveryFile' | 'discoveryHttp',
): { targets: TrinnovProcessorTarget[]; httpTargetsUrl?: string } {
  const { targets, httpTargetsUrl } = parseDiscoveryPayload(raw, source);
  return {
    targets: targets.map(toTrinnovTarget),
    httpTargetsUrl,
  };
}

export function extractTrinnovTargetsFromHomebridgeConfig(
  rawConfig: unknown,
): TrinnovProcessorTarget[] {
  return extractTargetsFromHomebridgeConfig(rawConfig)
    .filter((t) => t.driver === 'trinnov')
    .map(toTrinnovTarget);
}

export class TrinnovTargetResolver {
  private readonly inner: TargetResolver;

  constructor(options: TrinnovTargetResolverOptions, log: CecLogger) {
    this.inner = new TargetResolver(
      {
        mode: options.mode === 'enabled' ? 'trinnov' : options.mode ?? 'auto',
        host: options.host,
        port: options.port,
        volumeStepDb: options.volumeStepDb,
        discoveryUrl: options.discoveryUrl,
        storagePath: options.storagePath,
        configPath: options.configPath,
        httpFetcher: options.httpFetcher,
      },
      log,
    );
  }

  public start(): void {
    this.inner.start();
  }

  public stop(): void {
    this.inner.stop();
  }

  public refreshSync(): void {
    this.inner.refreshSync();
  }

  public async refreshHttp(): Promise<void> {
    return this.inner.refreshHttp();
  }

  public resolveForAppleTv(params: {
    displayName: string;
    osdString: string;
    deviceOverride?: AppleTvTrinnovOverride;
  }): ResolvedTrinnovTarget | null {
    const resolved = this.inner.resolveForAppleTv(params);
    if (!resolved) {
      return null;
    }
    return {
      target: toTrinnovTarget(resolved.target),
      stepDb: resolved.stepDb,
    };
  }

  public getCandidateList(): TrinnovProcessorTarget[] {
    return this.inner.getCandidateList().map(toTrinnovTarget);
  }
}

export interface TrinnovTcpClientOptions {
  host: string;
  port?: number;
  clientId?: string;
  idleTimeoutMs?: number;
  connectTimeoutMs?: number;
  socketFactory?: (port: number, host: string) => net.Socket;
}

export class TrinnovTcpClient {
  public readonly host: string;
  public readonly port: number;
  private readonly driver: TcpTargetDriver;

  constructor(options: TrinnovTcpClientOptions, log: CecLogger) {
    this.driver = new TcpTargetDriver(
      {
        host: options.host,
        port: options.port ?? TRINNOV_DEFAULT_PORT,
        driverLabel: 'Trinnov',
        clientId: options.clientId,
        idleTimeoutMs: options.idleTimeoutMs,
        connectTimeoutMs: options.connectTimeoutMs,
        commands: TRINNOV_TCP_PRESET,
        socketFactory: options.socketFactory,
      },
      log,
    );
    this.host = this.driver.host;
    this.port = this.driver.port;
  }

  public adjustVolume(deltaDb: number): void {
    if (deltaDb >= 0) {
      this.driver.sendAction('volumeUp', { stepDb: deltaDb });
    } else {
      this.driver.sendAction('volumeDown', { stepDb: Math.abs(deltaDb) });
    }
  }

  public toggleMute(): void {
    this.driver.sendAction('muteToggle');
  }

  public sendCommand(command: string): void {
    this.driver.sendRawLine(command);
  }

  public stop(): void {
    this.driver.disconnect();
  }
}

export class TrinnovClientPool {
  private readonly pool: TargetDriverPool;

  constructor(
    options: {
      clientId?: string;
      idleTimeoutMs?: number;
      connectTimeoutMs?: number;
      socketFactory?: (port: number, host: string) => net.Socket;
    },
    log: CecLogger,
  ) {
    this.pool = new TargetDriverPool(options, log);
  }

  public adjustVolume(target: TrinnovProcessorTarget, deltaDb: number): void {
    const spec = {
      id: target.id,
      name: target.name,
      driver: 'trinnov' as const,
      host: target.host,
      port: target.port,
      volumeStepDb: target.volumeStepDb,
    };
    if (deltaDb >= 0) {
      this.pool.sendAction(spec, 'volumeUp', { stepDb: deltaDb });
    } else {
      this.pool.sendAction(spec, 'volumeDown', { stepDb: Math.abs(deltaDb) });
    }
  }

  public toggleMute(target: TrinnovProcessorTarget): void {
    this.pool.sendAction(
      {
        id: target.id,
        name: target.name,
        driver: 'trinnov' as const,
        host: target.host,
        port: target.port,
        volumeStepDb: target.volumeStepDb,
      },
      'muteToggle',
    );
  }

  public stopAll(): void {
    this.pool.stopAll();
  }
}
