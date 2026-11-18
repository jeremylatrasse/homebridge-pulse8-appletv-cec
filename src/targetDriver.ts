import * as net from 'node:net';
import { CecLogger } from './cecClient';

export const TRINNOV_DEFAULT_PORT = 44100;

export type TargetAction =
  | 'volumeUp'
  | 'volumeDown'
  | 'muteToggle'
  | 'powerOn'
  | 'powerOff'
  | 'powerToggle';

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

export const TRINNOV_TCP_PRESET: TcpCommandTemplates = {
  init: 'id {{clientId}}',
  volumeUp: 'dvolume {{stepDb}}',
  volumeDown: 'dvolume -{{stepDb}}',
  mute: 'mute 2',
  bye: 'bye',
  lineEnding: '\n',
  waitForBannerMs: 250,
  bannerIncludes: 'welcome',
  handshakeExpect: 'ok',
};

export const ANTHEM_TCP_PRESET: TcpCommandTemplates = {
  volumeUp: 'Z1VUP;',
  volumeDown: 'Z1VDN;',
  mute: 'Z1MUT;',
  powerOn: 'Z1POW1;',
  powerOff: 'Z1POW0;',
  lineEnding: '\n',
};

export const DENON_MARANTZ_TCP_PRESET: TcpCommandTemplates = {
  volumeUp: 'MVUP',
  volumeDown: 'MVDOWN',
  mute: 'MUON',
  powerOn: 'PWON',
  powerOff: 'PWSTANDBY',
  lineEnding: '\r',
};

export const PIONEER_TCP_PRESET: TcpCommandTemplates = {
  volumeUp: 'VU',
  volumeDown: 'VD',
  mute: 'MZ',
  powerOn: 'PO',
  powerOff: 'PF',
  lineEnding: '\r',
};

export const STORMAUDIO_TCP_PRESET: TcpCommandTemplates = {
  volumeUp: 'ssp.vol.up',
  volumeDown: 'ssp.vol.down',
  mute: 'ssp.mute.toggle',
  powerOn: 'ssp.power.on',
  powerOff: 'ssp.power.off',
  lineEnding: '\n',
};

export const LYNGDORF_TCP_PRESET: TcpCommandTemplates = {
  volumeUp: '!VOLUP',
  volumeDown: '!VOLDN',
  mute: '!MUTE',
  powerOn: '!POWERON',
  powerOff: '!POWEROFF',
  lineEnding: '\r',
};

export const YAMAHA_HTTP_PRESET: HttpEndpointsConfig = {
  volumeUp: { url: '/YamahaExtendedControl/v1/main/setVolume?volume=up', method: 'GET' },
  volumeDown: { url: '/YamahaExtendedControl/v1/main/setVolume?volume=down', method: 'GET' },
  powerOn: { url: '/YamahaExtendedControl/v1/main/setPower?power=on', method: 'GET' },
  powerOff: { url: '/YamahaExtendedControl/v1/main/setPower?power=standby', method: 'GET' },
};

export interface BuiltInTargetPreset {
  id: string;
  driver: TargetDriverType;
  defaultPort: number;
  tcpCommands?: TcpCommandTemplates;
  httpEndpoints?: HttpEndpointsConfig;
}

const PRESET_MATCHERS: Array<{ keywords: string[]; preset: BuiltInTargetPreset }> = [
  {
    keywords: ['trinnov'],
    preset: {
      id: 'trinnov',
      driver: 'trinnov',
      defaultPort: TRINNOV_DEFAULT_PORT,
      tcpCommands: TRINNOV_TCP_PRESET,
    },
  },
  {
    keywords: ['anthem', 'mrx', 'avm'],
    preset: {
      id: 'anthem',
      driver: 'tcp',
      defaultPort: 14999,
      tcpCommands: ANTHEM_TCP_PRESET,
    },
  },
  {
    keywords: ['denon', 'marantz'],
    preset: {
      id: 'denon-marantz',
      driver: 'tcp',
      defaultPort: 23,
      tcpCommands: DENON_MARANTZ_TCP_PRESET,
    },
  },
  {
    keywords: ['pioneer'],
    preset: {
      id: 'pioneer',
      driver: 'tcp',
      defaultPort: 23,
      tcpCommands: PIONEER_TCP_PRESET,
    },
  },
  {
    keywords: ['stormaudio', 'storm-audio', 'storm'],
    preset: {
      id: 'stormaudio',
      driver: 'tcp',
      defaultPort: 23,
      tcpCommands: STORMAUDIO_TCP_PRESET,
    },
  },
  {
    keywords: ['lyngdorf'],
    preset: {
      id: 'lyngdorf',
      driver: 'tcp',
      defaultPort: 84,
      tcpCommands: LYNGDORF_TCP_PRESET,
    },
  },
  {
    keywords: ['yamaha'],
    preset: {
      id: 'yamaha',
      driver: 'http',
      defaultPort: 80,
      httpEndpoints: YAMAHA_HTTP_PRESET,
    },
  },
];

export function matchBuiltInTargetPreset(hint: string): BuiltInTargetPreset | null {
  const lower = hint.toLowerCase();
  for (const entry of PRESET_MATCHERS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.preset;
    }
  }
  return null;
}

export function normalizePort(rawPort: unknown, fallback = TRINNOV_DEFAULT_PORT): number {
  if (typeof rawPort === 'number' && Number.isFinite(rawPort)) {
    const p = Math.floor(rawPort);
    if (p >= 1 && p <= 65535) {
      return p;
    }
  }
  if (typeof rawPort === 'string' && /^\d+$/.test(rawPort.trim())) {
    const p = parseInt(rawPort.trim(), 10);
    if (p >= 1 && p <= 65535) {
      return p;
    }
  }
  return fallback;
}

function unescapeControlChars(input: string): string {
  return input
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    return vars[key] ?? '';
  });
}

function renderTemplateValue(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return renderTemplate(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplateValue(item, vars));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = renderTemplateValue(v, vars);
    }
    return out;
  }
  return value;
}

function buildTemplateVars(
  action: TargetAction | 'init' | 'bye',
  clientId: string,
  context?: ActionContext,
): Record<string, string> {
  const stepDb =
    typeof context?.stepDb === 'number' && Number.isFinite(context.stepDb)
      ? context.stepDb
      : 1;
  return {
    stepDb: Number(stepDb.toFixed(2)).toString(),
    '-stepDb': Number((-stepDb).toFixed(2)).toString(),
    clientId,
    action,
    source: context?.sourceName ?? '',
    logicalAddress: context?.logicalAddress ?? '',
  };
}

function encodeTcpPayload(rendered: string, lineEnding: string): Buffer | null {
  const trimmed = rendered.trim();
  if (!trimmed) {
    return null;
  }

  if (/^hex:/i.test(trimmed)) {
    const hexBody = trimmed.slice(4).replace(/[^0-9a-fA-F]/g, '');
    if (hexBody.length === 0 || hexBody.length % 2 !== 0) {
      return null;
    }
    return Buffer.from(hexBody, 'hex');
  }

  const unescaped = unescapeControlChars(rendered);
  const withEnding =
    unescaped.endsWith('\n') || unescaped.endsWith('\r') ? unescaped : `${unescaped}${lineEnding}`;
  return Buffer.from(withEnding, 'utf8');
}

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

type ConnectionState = 'disconnected' | 'connecting' | 'handshaking' | 'ready';

export class TcpTargetDriver implements TargetDriver {
  public readonly key: string;
  public readonly host: string;
  public readonly port: number;

  private readonly driverLabel: string;
  private readonly clientId: string;
  private readonly idleTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly commands: TcpCommandTemplates;
  private readonly lineEnding: string;
  private readonly socketFactory: (port: number, host: string) => net.Socket;

  private socket: net.Socket | null = null;
  private state: ConnectionState = 'disconnected';
  private isStopped = false;
  private readBuffer = '';
  private initSent = false;
  private pendingPayloads: Buffer[] = [];

  private connectTimer: NodeJS.Timeout | null = null;
  private welcomeFallbackTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastWarnAt = 0;

  constructor(
    options: TcpTargetDriverOptions,
    private readonly log: CecLogger,
  ) {
    this.host = options.host;
    this.port = normalizePort(options.port);
    this.driverLabel = options.driverLabel || 'TCP';
    this.key = `${this.driverLabel.toLowerCase()}:${this.host.toLowerCase()}:${this.port}`;
    this.clientId = (options.clientId?.trim() || 'homebridge-pulse8-appletv-cec').replace(/[\r\n]/g, ' ');
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2000;
    this.commands = options.commands ?? {};
    this.lineEnding = unescapeControlChars(this.commands.lineEnding ?? '\n');
    this.socketFactory =
      options.socketFactory ?? ((port, host) => net.createConnection({ port, host }));
  }

  public connect(): void {
    if (this.isStopped || this.state !== 'disconnected') {
      return;
    }

    this.state = 'connecting';
    this.initSent = false;
    this.readBuffer = '';

    const socket = this.socketFactory(this.port, this.host);
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15000);

    this.connectTimer = setTimeout(() => {
      this.handleFailure(
        `Connection to ${this.driverLabel} ${this.host}:${this.port} timed out after ${this.connectTimeoutMs}ms`,
      );
    }, this.connectTimeoutMs);

    socket.on('connect', () => {
      if (this.socket !== socket) {
        return;
      }
      this.clearConnectTimer();

      const hasInit = this.getInitCommands().length > 0;
      const expectHandshake = Boolean(this.commands.handshakeExpect?.trim());

      if (hasInit && expectHandshake) {
        this.state = 'handshaking';
        const waitMs = Math.max(0, this.commands.waitForBannerMs ?? 250);
        if (waitMs === 0) {
          this.sendInitCommands();
        } else {
          this.welcomeFallbackTimer = setTimeout(() => {
            this.sendInitCommands();
          }, waitMs);
        }

        this.handshakeTimer = setTimeout(() => {
          this.handleFailure(`${this.driverLabel} ${this.host}:${this.port} handshake timed out`);
        }, 2000);
        return;
      }

      if (hasInit) {
        this.sendInitCommands();
      }
      this.state = 'ready';
      this.log.debug(`[${this.driverLabel}] Connected to ${this.host}:${this.port}`);
      this.flushPendingPayloads();
    });

    socket.on('data', (chunk: Buffer) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleData(chunk.toString('utf8'));
    });

    socket.on('error', (err: Error) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleFailure(`${this.driverLabel} TCP error (${this.host}:${this.port}): ${err.message}`);
    });

    socket.on('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.cleanupSocket();
    });
  }

  public sendAction(action: TargetAction, context?: ActionContext): void {
    if (this.isStopped) {
      return;
    }

    const template = this.resolveActionTemplate(action);
    if (!template) {
      this.log.debug(
        `[${this.driverLabel}] No command configured for action "${action}" on ${this.host}:${this.port}`,
      );
      return;
    }

    const vars = buildTemplateVars(action, this.clientId, context);
    const rendered = renderTemplate(template, vars);
    const payload = encodeTcpPayload(rendered, this.lineEnding);
    if (!payload) {
      return;
    }

    this.enqueueOrWritePayload(payload);
  }

  public sendRawLine(line: string): void {
    if (this.isStopped) {
      return;
    }
    const payload = encodeTcpPayload(line, this.lineEnding);
    if (!payload) {
      return;
    }
    this.enqueueOrWritePayload(payload);
  }

  public disconnect(): void {
    this.isStopped = true;
    this.pendingPayloads = [];
    this.clearAllTimers();

    if (this.socket && !this.socket.destroyed) {
      const sock = this.socket;
      const byePayload = this.renderByePayload();
      if (this.state === 'ready' && sock.writable && byePayload) {
        try {
          sock.end(byePayload);
          const forceDestroy = setTimeout(() => {
            if (!sock.destroyed) {
              sock.destroy();
            }
          }, 150);
          forceDestroy.unref();
        } catch {
          sock.destroy();
        }
      } else {
        sock.destroy();
      }
    }
    this.socket = null;
    this.state = 'disconnected';
  }

  private resolveActionTemplate(action: TargetAction): string | undefined {
    switch (action) {
      case 'volumeUp':
        return this.commands.volumeUp;
      case 'volumeDown':
        return this.commands.volumeDown;
      case 'muteToggle':
        return this.commands.mute;
      case 'powerOn':
        return this.commands.powerOn;
      case 'powerOff':
        return this.commands.powerOff;
      case 'powerToggle':
        return this.commands.powerToggle;
    }
  }

  private getInitCommands(): string[] {
    if (!this.commands.init) {
      return [];
    }
    return Array.isArray(this.commands.init) ? this.commands.init : [this.commands.init];
  }

  private renderByePayload(): Buffer | null {
    if (!this.commands.bye) {
      return null;
    }
    const vars = buildTemplateVars('bye', this.clientId);
    const rendered = renderTemplate(this.commands.bye, vars);
    return encodeTcpPayload(rendered, this.lineEnding);
  }

  private enqueueOrWritePayload(payload: Buffer): void {
    this.isStopped = false;
    this.resetIdleTimer();

    if (this.state === 'ready' && this.socket && !this.socket.destroyed && this.socket.writable) {
      this.writePayload(payload);
      return;
    }

    if (this.pendingPayloads.length >= 12) {
      this.pendingPayloads.shift();
    }
    this.pendingPayloads.push(payload);

    if (this.state === 'disconnected') {
      this.connect();
    }
  }

  private handleData(text: string): void {
    this.readBuffer += text;
    let newlineIdx = this.readBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = this.readBuffer.slice(0, newlineIdx).replace(/\r$/, '').trim();
      this.readBuffer = this.readBuffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        this.handleLine(line);
      }
      newlineIdx = this.readBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const lower = line.toLowerCase();

    if (this.state === 'handshaking') {
      const bannerMatch = this.commands.bannerIncludes?.trim().toLowerCase();
      if (bannerMatch && lower.includes(bannerMatch) && !this.initSent) {
        this.sendInitCommands();
        return;
      }

      const expected = this.commands.handshakeExpect?.trim().toLowerCase();
      if (expected && (lower === expected || lower.startsWith(`${expected} `))) {
        this.clearHandshakeTimers();
        this.state = 'ready';
        this.log.debug(`[${this.driverLabel}] Connected and authenticated with ${this.host}:${this.port}`);
        this.flushPendingPayloads();
        return;
      }

      if (lower.startsWith('error')) {
        this.log.warn(`[${this.driverLabel}] Handshake warning from ${this.host}:${this.port}: ${line}`);
        return;
      }
    }

    if (lower.startsWith('error')) {
      this.log.warn(`[${this.driverLabel}] ${this.host}:${this.port} returned ${line}`);
    } else {
      this.log.debug(`[${this.driverLabel} ${this.host}:${this.port}] ${line}`);
    }
  }

  private sendInitCommands(): void {
    if (this.initSent || !this.socket || this.socket.destroyed) {
      return;
    }
    this.initSent = true;
    if (this.welcomeFallbackTimer) {
      clearTimeout(this.welcomeFallbackTimer);
      this.welcomeFallbackTimer = null;
    }

    const vars = buildTemplateVars('init', this.clientId);
    for (const rawCmd of this.getInitCommands()) {
      const rendered = renderTemplate(rawCmd, vars);
      const payload = encodeTcpPayload(rendered, this.lineEnding);
      if (payload) {
        this.writePayload(payload);
      }
    }
  }

  private flushPendingPayloads(): void {
    if (this.state !== 'ready' || !this.socket || this.socket.destroyed || !this.socket.writable) {
      return;
    }
    const payloads = this.pendingPayloads.splice(0, this.pendingPayloads.length);
    for (const payload of payloads) {
      this.writePayload(payload);
    }
  }

  private writePayload(payload: Buffer): void {
    if (!this.socket || this.socket.destroyed || !this.socket.writable) {
      return;
    }
    this.log.debug(`[${this.driverLabel} ${this.host}:${this.port}] -> ${payload.toString('utf8').trim()}`);
    this.socket.write(payload);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        if (this.socket && !this.socket.destroyed) {
          this.log.debug(`[${this.driverLabel}] Closing idle connection to ${this.host}:${this.port}`);
          const byePayload = this.renderByePayload();
          if (this.state === 'ready' && this.socket.writable && byePayload) {
            try {
              this.socket.write(byePayload);
            } catch {
              // Ignore write error on idle close
            }
          }
          this.socket.end();
        }
      }, this.idleTimeoutMs);
      this.idleTimer.unref();
    }
  }

  private handleFailure(message: string): void {
    // Drop queued commands on connection failure so they never replay in a burst later
    this.pendingPayloads = [];
    const now = Date.now();
    if (now - this.lastWarnAt > 10000) {
      this.lastWarnAt = now;
      this.log.warn(`[${this.driverLabel}] ${message}`);
    } else {
      this.log.debug(`[${this.driverLabel}] ${message}`);
    }
    this.cleanupSocket();
  }

  private cleanupSocket(): void {
    this.clearAllTimers();
    if (this.socket) {
      if (!this.socket.destroyed) {
        this.socket.destroy();
      }
      this.socket = null;
    }
    this.state = 'disconnected';
    this.initSent = false;
    this.readBuffer = '';
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearHandshakeTimers(): void {
    if (this.welcomeFallbackTimer) {
      clearTimeout(this.welcomeFallbackTimer);
      this.welcomeFallbackTimer = null;
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearConnectTimer();
    this.clearHandshakeTimers();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

export type HttpFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export interface HttpTargetDriverOptions {
  host?: string;
  port?: number;
  baseUrl?: string;
  endpoints?: HttpEndpointsConfig;
  requestTimeoutMs?: number;
  fetcher?: HttpFetchFn;
}

export class HttpTargetDriver implements TargetDriver {
  public readonly key: string;
  private readonly baseUrl?: string;
  private readonly endpoints: HttpEndpointsConfig;
  private readonly requestTimeoutMs: number;
  private readonly fetcher: HttpFetchFn;
  private lastWarnAt = 0;

  constructor(
    options: HttpTargetDriverOptions,
    private readonly log: CecLogger,
  ) {
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    } else if (options.host) {
      const port = options.port ?? 80;
      const scheme = port === 443 ? 'https' : 'http';
      this.baseUrl = `${scheme}://${options.host}:${port}`;
    }
    this.key = `http:${this.baseUrl || 'custom'}`;
    this.endpoints = options.endpoints ?? {};
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3000;
    this.fetcher =
      options.fetcher ??
      ((url, init) => fetch(url, init));
  }

  public connect(): void {
    // HTTP driver is stateless per request
  }

  public async sendAction(action: TargetAction, context?: ActionContext): Promise<void> {
    const rawDef = this.resolveEndpoint(action);
    if (!rawDef) {
      this.log.debug(`[HTTP] No endpoint configured for action "${action}"`);
      return;
    }

    const def: HttpEndpointDefinition =
      typeof rawDef === 'string' ? { url: rawDef, method: 'POST' } : rawDef;

    const vars = buildTemplateVars(action, 'homebridge-pulse8-appletv-cec', context);
    const renderedUrl = renderTemplate(def.url.trim(), vars);
    const resolvedUrl = this.resolveUrl(renderedUrl);
    if (!resolvedUrl) {
      return;
    }

    const method = (def.method || 'POST').toUpperCase();
    const headers: Record<string, string> = {};
    if (def.headers) {
      for (const [k, v] of Object.entries(def.headers)) {
        headers[k] = renderTemplate(String(v), vars);
      }
    }

    let body: string | undefined;
    if (def.body !== undefined && def.body !== null && method !== 'GET') {
      const renderedBody = renderTemplateValue(def.body, vars);
      if (typeof renderedBody === 'string') {
        body = renderedBody;
      } else {
        body = JSON.stringify(renderedBody);
        const hasContentType = Object.keys(headers).some(
          (h) => h.toLowerCase() === 'content-type',
        );
        if (!hasContentType) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      this.log.debug(`[HTTP] ${method} ${resolvedUrl}`);
      const res = await this.fetcher(resolvedUrl, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        this.warnThrottled(`[HTTP] ${method} ${resolvedUrl} returned HTTP ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.warnThrottled(`[HTTP] ${method} ${resolvedUrl} failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  public disconnect(): void {
    // Nothing persistent to close
  }

  private resolveEndpoint(action: TargetAction): HttpEndpointDefinition | string | undefined {
    switch (action) {
      case 'volumeUp':
        return this.endpoints.volumeUp;
      case 'volumeDown':
        return this.endpoints.volumeDown;
      case 'muteToggle':
        return this.endpoints.mute;
      case 'powerOn':
        return this.endpoints.powerOn;
      case 'powerOff':
        return this.endpoints.powerOff;
      case 'powerToggle':
        return this.endpoints.powerToggle;
    }
  }

  private resolveUrl(url: string): string | null {
    if (!url) {
      return null;
    }
    if (/^https?:\/\//i.test(url)) {
      return url;
    }
    if (this.baseUrl) {
      const suffix = url.startsWith('/') ? url : `/${url}`;
      return `${this.baseUrl}${suffix}`;
    }
    return null;
  }

  private warnThrottled(message: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt > 10000) {
      this.lastWarnAt = now;
      this.log.warn(message);
    } else {
      this.log.debug(message);
    }
  }
}

export class TargetDriverPool {
  private readonly drivers = new Map<string, TargetDriver>();

  constructor(
    private readonly options: {
      clientId?: string;
      idleTimeoutMs?: number;
      connectTimeoutMs?: number;
      requestTimeoutMs?: number;
      tcpCommands?: TcpCommandTemplates;
      httpEndpoints?: HttpEndpointsConfig;
      socketFactory?: (port: number, host: string) => net.Socket;
      httpFetcher?: HttpFetchFn;
    },
    private readonly log: CecLogger,
  ) {}

  public sendAction(target: TargetSpec, action: TargetAction, context?: ActionContext): void {
    const driver = this.getDriver(target);
    void driver.sendAction(action, context);
  }

  public stopAll(): void {
    for (const driver of this.drivers.values()) {
      driver.disconnect();
    }
    this.drivers.clear();
  }

  private getDriver(target: TargetSpec): TargetDriver {
    const effectiveCommands =
      target.driver === 'trinnov'
        ? { ...TRINNOV_TCP_PRESET, ...this.options.tcpCommands, ...target.tcpCommands }
        : { ...this.options.tcpCommands, ...target.tcpCommands };

    const effectiveHttpEndpoints = {
      ...this.options.httpEndpoints,
      ...target.httpEndpoints,
    };

    const configFingerprint =
      target.driver === 'http'
        ? JSON.stringify(effectiveHttpEndpoints)
        : JSON.stringify(effectiveCommands);

    const key = `${target.driver}:${target.host.toLowerCase()}:${target.port}:${configFingerprint}`;
    let driver = this.drivers.get(key);
    if (!driver) {
      if (target.driver === 'http') {
        driver = new HttpTargetDriver(
          {
            host: target.host,
            port: target.port,
            baseUrl: target.httpEndpoint,
            endpoints: effectiveHttpEndpoints,
            requestTimeoutMs: this.options.requestTimeoutMs,
            fetcher: this.options.httpFetcher,
          },
          this.log,
        );
      } else {
        driver = new TcpTargetDriver(
          {
            host: target.host,
            port: target.port,
            driverLabel: target.driver === 'trinnov' ? 'Trinnov' : 'TCP',
            clientId: this.options.clientId,
            idleTimeoutMs: this.options.idleTimeoutMs,
            connectTimeoutMs: this.options.connectTimeoutMs,
            commands: effectiveCommands,
            socketFactory: this.options.socketFactory,
          },
          this.log,
        );
      }
      this.drivers.set(key, driver);
    }
    return driver;
  }
}
