import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Pulse8CecClient,
  parseScanOutput,
  parseTrafficFrame,
  resolveCecClientPath,
} from './dist/cecClient.js';
import { matchesAppleTvFilter, normalizePlatformConfig } from './dist/platform.js';
import { Pulse8AppleTvAccessory, sanitizeHomeKitName } from './dist/platformAccessory.js';
import {
  GENERIC_DISCOVERY_FILENAME,
  TargetResolver,
  extractTargetsFromHomebridgeConfig,
} from './dist/targetDiscovery.js';
import { HttpTargetDriver, TcpTargetDriver } from './dist/targetDriver.js';
import {
  TRINNOV_DISCOVERY_FILENAME,
  TrinnovTargetResolver,
  TrinnovTcpClient,
  extractTrinnovTargetsFromHomebridgeConfig,
  parseTrinnovDiscoveryPayload,
} from './dist/trinnovClient.js';

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('Running homebridge-pulse8-appletv-cec unit tests...');

// 1. Validate config.schema.json
const schema = JSON.parse(readFileSync('./config.schema.json', 'utf8'));
assert.strictEqual(schema.pluginAlias, 'Pulse8AppleTvCec');
assert.strictEqual(schema.pluginType, 'platform');
assert.strictEqual(schema.schema.properties.holdMode.default, 'longPress');
assert.strictEqual(schema.schema.properties.targetMode.default, 'auto');
assert.strictEqual(schema.schema.properties.powerSensorType.default, 'none');
assert.strictEqual(schema.schema.properties.powerKeyMode.default, 'ignore');
assert.strictEqual(schema.schema.properties.trinnovControl.default, 'auto');
assert.strictEqual(schema.schema.properties.trinnovPort.default, 44100);

// 1b. Validate normalizePlatformConfig & legacy trinnov* alias fallback
const normalizedLegacy = normalizePlatformConfig({
  targetMode: 'auto', // e.g. injected by Config UI X default
  trinnovControl: 'enabled',
  trinnovHost: '192.168.1.50',
  trinnovPort: 44100,
  trinnovVolumeStepDb: 0.5,
  trinnovMuteAction: 'ignore',
  trinnovDiscoveryUrl: 'http://127.0.0.1:44180/api/cec/targets',
  trinnovClientId: 'my-hb',
  trinnovIdleTimeoutMs: 30000,
});
assert.strictEqual(normalizedLegacy.targetMode, 'trinnov');
assert.strictEqual(normalizedLegacy.targetHost, '192.168.1.50');
assert.strictEqual(normalizedLegacy.targetPort, 44100);
assert.strictEqual(normalizedLegacy.targetVolumeStepDb, 0.5);
assert.strictEqual(normalizedLegacy.targetMuteAction, 'ignore');
assert.strictEqual(normalizedLegacy.targetDiscoveryUrl, 'http://127.0.0.1:44180/api/cec/targets');
assert.strictEqual(normalizedLegacy.targetClientId, 'my-hb');
assert.strictEqual(normalizedLegacy.targetIdleTimeoutMs, 30000);

const normalizedExplicitTarget = normalizePlatformConfig({
  targetMode: 'tcp',
  trinnovControl: 'enabled',
  targetHost: '10.0.0.20',
  trinnovHost: '192.168.1.50',
  targetPort: 14999,
  trinnovPort: 44100,
  powerSensorType: 'occupancy',
  includePowerButtons: true,
  powerKeyMode: 'handle',
});
assert.strictEqual(normalizedExplicitTarget.targetMode, 'tcp');
assert.strictEqual(normalizedExplicitTarget.targetHost, '10.0.0.20');
assert.strictEqual(normalizedExplicitTarget.targetPort, 14999);
assert.strictEqual(normalizedExplicitTarget.powerSensorType, 'occupancy');
assert.strictEqual(normalizedExplicitTarget.includePowerButtons, true);
assert.strictEqual(normalizedExplicitTarget.powerKeyMode, 'handle');

// 2. Test sanitizeHomeKitName
assert.strictEqual(sanitizeHomeKitName('Living Room (Apple TV)'), 'Living Room Apple TV');

// 2b. Test resolveCecClientPath across restricted Homebridge PATHs and missing binaries
assert.strictEqual(
  resolveCecClientPath({
    configuredPath: 'cec-client',
    envPath: '/usr/bin:/bin',
    isExecutable: (p) => p === '/opt/homebrew/bin/cec-client',
  }),
  '/opt/homebrew/bin/cec-client',
);
assert.strictEqual(
  resolveCecClientPath({
    configuredPath: '/custom/bin/cec-client',
    envPath: '/usr/bin:/bin',
    isExecutable: (p) => p === '/custom/bin/cec-client',
  }),
  '/custom/bin/cec-client',
);
assert.strictEqual(
  resolveCecClientPath({
    configuredPath: '/nonexistent/cec-client',
    isExecutable: () => false,
  }),
  null,
);

// 2c. Test Pulse8CecClient missing binary handling (no -2 crash loop)
const missingLogs = { errors: [], warns: [] };
const missingClient = new Pulse8CecClient(
  { cecClientPath: '/nonexistent/path/to/cec-client-missing' },
  {
    info: () => {},
    warn: (m) => missingLogs.warns.push(m),
    error: (m) => missingLogs.errors.push(m),
    debug: () => {},
  },
);
missingClient.start();
await sleep(30);
missingClient.stop();
assert.strictEqual(missingLogs.errors.length, 1);
assert.match(missingLogs.errors[0], /was not found or is not executable/i);
assert.strictEqual(missingLogs.warns.length, 0);

// 3. Test parseScanOutput with multiple Apple TVs (including decimal #11 -> hex 'b' and custom OSD name)
const scanLines = [
  'device #0: TV',
  'address:       0.0.0.0',
  'active source: no',
  'vendor:        LG',
  'osd string:    LG TV',
  'device #4: Playback 1',
  'address:       6.0.0.0',
  'active source: yes',
  'vendor:        Apple',
  'osd string:    Apple TV',
  'device #11: Playback 3',
  'address:       2.0.0.0',
  'active source: no',
  'vendor:        Apple',
  'osd string:    Bedroom',
  'device #5: Audio',
  'address:       1.0.0.0',
  'active source: no',
  'vendor:        Pulse-Eight',
  'osd string:    Homebridge',
];
const parsedScan = parseScanOutput(scanLines);
assert.strictEqual(parsedScan.length, 4);
const appleTvs = parsedScan.filter((d) => d.isAppleTv);
assert.strictEqual(appleTvs.length, 2);
assert.strictEqual(appleTvs[0].logicalAddress, '4');
assert.strictEqual(appleTvs[0].physicalAddress, '6.0.0.0');
assert.strictEqual(appleTvs[1].logicalAddress, 'b');
assert.strictEqual(appleTvs[1].osdString, 'Bedroom');

// 4. Test matchesAppleTvFilter
assert.strictEqual(matchesAppleTvFilter(appleTvs[1], { logicalAddress: 'B' }), true);
assert.strictEqual(matchesAppleTvFilter(appleTvs[1], { physicalAddress: '2.0.0.0' }), true);
assert.strictEqual(matchesAppleTvFilter(appleTvs[1], { osdName: 'bedroom' }), true);
assert.strictEqual(matchesAppleTvFilter(appleTvs[1], { logicalAddress: '4' }), false);

// 5. Test parseTrafficFrame
const frame = parseTrafficFrame('TRAFFIC: [  1042] >> 85:44:41');
assert.deepStrictEqual(frame, {
  src: '8',
  dst: '5',
  opcode: '44',
  arg: '41',
  bytes: ['85', '44', '41'],
});
assert.strictEqual(parseTrafficFrame('DEBUG: something else'), null);

// 6. Test CEC protocol replies, non-spam on 84, ignored power keys, powerChange/action events, and initial null power state
const sentCommands = [];
const keyEvents = [];
const volumeCommands = [];
const powerChanges = [];
const semanticActions = [];
const client = new Pulse8CecClient(
  {
    holdMode: 'longPress',
    holdDelayMs: 80,
    holdRepeatMs: 35,
    holdSafetyMs: 250,
    powerDebounceMs: 120,
    rawSender: (cmd) => sentCommands.push(cmd),
  },
  silentLog,
);
client.on('keyPress', (evt) => keyEvents.push(evt));
client.on('volumeCommand', (evt) => volumeCommands.push(evt));
client.on('powerChange', (evt) => powerChanges.push(evt));
client.on('action', (evt) => semanticActions.push(evt));

// Adapter ready -> System Audio Mode + scan
client.handleLine('waiting for input');
assert.deepStrictEqual(sentCommands, ['tx 5F:72:01', 'scan']);
sentCommands.length = 0;

// Feed scan result with Apple TV at logical address '8'
for (const line of [
  'device #8: Playback 2',
  'address:       3.0.0.0',
  'active source: yes',
  'vendor:        Apple',
  'osd string:    Theater Apple TV',
  'currently active source: Playback 2 (8)',
]) {
  client.handleLine(line);
}
assert.strictEqual(client.getDiscoveredAppleTvs().length, 1);
assert.strictEqual(client.getBusPowerState('8'), null);

// Standby from null initial state should still transition to false and emit powerChange + powerOff
client.handleLine('TRAFFIC: [10] >> 8f:36');
assert.strictEqual(client.getBusPowerState('8'), false);
assert.strictEqual(powerChanges.length, 1);
assert.strictEqual(powerChanges[0].powered, false);
assert.strictEqual(powerChanges[0].previous, null);
assert.strictEqual(semanticActions[0].action, 'powerOff');

// Active Source transitions to true & re-asserts System Audio Mode
client.handleLine('TRAFFIC: [11] >> 8f:82');
assert.strictEqual(client.getBusPowerState('8'), true);
assert.strictEqual(powerChanges.length, 2);
assert.strictEqual(powerChanges[1].powered, true);
assert.strictEqual(powerChanges[1].previous, false);
assert.strictEqual(semanticActions[1].action, 'powerOn');
assert.deepStrictEqual(sentCommands, ['tx 5F:72:01']);
sentCommands.length = 0;

// Rapid true <-> false -> true flicker within powerDebounceMs (120ms) must NOT emit spurious OFF
client.handleLine('TRAFFIC: [11b] >> 8f:36');
assert.strictEqual(client.getBusPowerState('8'), true);
await sleep(30);
client.handleLine('TRAFFIC: [11c] >> 8f:82');
await sleep(120);
assert.strictEqual(client.getBusPowerState('8'), true);
assert.strictEqual(powerChanges.length, 2);

// Genuine Standby within powerDebounceMs settles after debounce window expires
client.handleLine('TRAFFIC: [11d] >> 8f:36');
await sleep(160);
assert.strictEqual(client.getBusPowerState('8'), false);
assert.strictEqual(powerChanges.length, 3);
assert.strictEqual(powerChanges[2].powered, false);

// Protocol status queries from dynamic initiator '8'
sentCommands.length = 0;
client.handleLine('TRAFFIC: [12] >> 85:70');
client.handleLine('TRAFFIC: [13] >> 85:7d');
client.handleLine('TRAFFIC: [14] >> 85:71');
client.handleLine('TRAFFIC: [15] >> 85:8f');
client.handleLine('TRAFFIC: [16] >> 8f:84'); // Report Physical Address -> must NOT spam tx 5F:72:01
assert.deepStrictEqual(sentCommands, [
  'tx 5F:72:01',
  'tx 5F:72:01',
  'tx 58:7a:32',
  'tx 58:90:00',
]);

// Power buttons (44:40 and 44:6c) must be ignored when powerKeyMode = 'ignore' (default)
client.handleLine('TRAFFIC: [17] >> 85:44:40');
client.handleLine('TRAFFIC: [18] >> 85:44:6c');
assert.strictEqual(keyEvents.length, 0);
assert.strictEqual(volumeCommands.length, 0);

// Mute press
client.handleLine('TRAFFIC: [19] >> 85:44:43');
assert.strictEqual(keyEvents.length, 1);
assert.strictEqual(keyEvents[0].logicalAddress, '8');
assert.strictEqual(keyEvents[0].key, 'mute');
assert.strictEqual(keyEvents[0].pressType, 'single');
assert.strictEqual(volumeCommands.length, 1);
assert.strictEqual(volumeCommands[0].key, 'mute');
assert.strictEqual(volumeCommands[0].isRepeat, false);
assert.strictEqual(semanticActions[semanticActions.length - 1].action, 'muteToggle');

// 6b. Test ignoreStandbyAfterWakeMs & powerKeyMode = 'handle'
const powerKeyEvents = [];
const powerKeyActions = [];
const powerKeyChanges = [];
const powerClient = new Pulse8CecClient(
  {
    powerDebounceMs: 0,
    ignoreStandbyAfterWakeMs: 120,
    powerKeyMode: 'handle',
    rawSender: () => {},
  },
  silentLog,
);
powerClient.on('keyPress', (e) => powerKeyEvents.push(e));
powerClient.on('action', (e) => powerKeyActions.push(e));
powerClient.on('powerChange', (e) => powerKeyChanges.push(e));
for (const line of [
  'device #4: Playback 1',
  'address:       1.0.0.0',
  'active source: yes',
  'vendor:        Apple',
  'osd string:    Apple TV',
  'currently active source: Playback 1 (4)',
]) {
  powerClient.handleLine(line);
}
// Wake -> Standby within 120ms is ignored
powerClient.handleLine('TRAFFIC: [1] >> 4f:04');
assert.strictEqual(powerClient.getBusPowerState('4'), true);
powerClient.handleLine('TRAFFIC: [2] >> 4f:36');
assert.strictEqual(powerClient.getBusPowerState('4'), true);

// After 120ms, Standby works
await sleep(140);
powerClient.handleLine('TRAFFIC: [3] >> 4f:36');
assert.strictEqual(powerClient.getBusPowerState('4'), false);

// Remote power keys when powerKeyMode = 'handle'
powerClient.handleLine('TRAFFIC: [4] >> 45:44:40'); // Toggle from false -> true (powerOn)
assert.strictEqual(powerClient.getBusPowerState('4'), true);
assert.strictEqual(powerKeyEvents[0].key, 'powerOn');
assert.strictEqual(powerKeyActions[powerKeyActions.length - 1].action, 'powerOn');
assert.strictEqual(powerKeyActions[powerKeyActions.length - 1].source, 'key');

powerClient.handleLine('TRAFFIC: [5] >> 45:44:6c'); // Dedicated powerOff
assert.strictEqual(powerClient.getBusPowerState('4'), false);
assert.strictEqual(powerKeyEvents[1].key, 'powerOff');

powerClient.handleLine('TRAFFIC: [6] >> 45:44:6d'); // Dedicated powerOn
assert.strictEqual(powerClient.getBusPowerState('4'), true);
assert.strictEqual(powerKeyEvents[2].key, 'powerOn');
assert.strictEqual(powerKeyChanges[powerKeyChanges.length - 1].source, 'key');
powerClient.stop();

// 7. Test longPress mode: short tap (< 80ms) -> single press on release, immediate volumeCommand on press
keyEvents.length = 0;
volumeCommands.length = 0;
client.handleLine('TRAFFIC: [20] >> 85:44:41');
assert.strictEqual(volumeCommands.length, 1);
assert.strictEqual(volumeCommands[0].key, 'volumeUp');
assert.strictEqual(volumeCommands[0].isRepeat, false);
await sleep(25);
client.handleLine('TRAFFIC: [21] >> 85:45');
assert.strictEqual(keyEvents.length, 1);
assert.strictEqual(keyEvents[0].key, 'volumeUp');
assert.strictEqual(keyEvents[0].pressType, 'single');
assert.strictEqual(volumeCommands.length, 1);

// 8. Test longPress mode: hold (>= 80ms) -> long press once for HomeKit, continuous volumeCommand steps while held
keyEvents.length = 0;
volumeCommands.length = 0;
client.handleLine('TRAFFIC: [22] >> 85:44:42');
await sleep(130);
client.handleLine('TRAFFIC: [23] >> 85:45');
assert.strictEqual(keyEvents.length, 1);
assert.strictEqual(keyEvents[0].key, 'volumeDown');
assert.strictEqual(keyEvents[0].pressType, 'long');
assert.ok(volumeCommands.length >= 2, `Expected >=2 direct volumeCommand ticks in longPress hold, got ${volumeCommands.length}`);
assert.strictEqual(volumeCommands[0].isRepeat, false);
assert.strictEqual(volumeCommands[1].isRepeat, true);

// 9. Test repeat mode: immediate single + repeats until release
const repeatEvents = [];
const repeatVolumeCmds = [];
const repeatClient = new Pulse8CecClient(
  {
    holdMode: 'repeat',
    holdDelayMs: 60,
    holdRepeatMs: 35,
    holdSafetyMs: 300,
    rawSender: () => {},
  },
  silentLog,
);
repeatClient.on('keyPress', (evt) => repeatEvents.push(evt));
repeatClient.on('volumeCommand', (evt) => repeatVolumeCmds.push(evt));
repeatClient.handleLine('TRAFFIC: [30] >> 45:44:41');
await sleep(115);
repeatClient.handleLine('TRAFFIC: [31] >> 45:45');
const countAtRelease = repeatEvents.length;
assert.ok(countAtRelease >= 2, `Expected >=2 repeat ticks, got ${countAtRelease}`);
assert.ok(repeatEvents.every((e) => e.key === 'volumeUp' && e.pressType === 'single'));
assert.strictEqual(repeatVolumeCmds.length, countAtRelease);
await sleep(80);
assert.strictEqual(repeatEvents.length, countAtRelease, 'Repeat timer must stop after 45 release');

client.stop();
repeatClient.stop();

// 10. Test Trinnov discovery parsing & Homebridge config.json fallback extraction
const parsedDiscovery = parseTrinnovDiscoveryPayload(
  {
    version: 1,
    plugin: 'homebridge-trinnov',
    http: { baseUrl: 'http://127.0.0.1:44180', targetsPath: '/api/cec/targets' },
    processors: [
      {
        id: 'living-trinnov',
        name: 'Living Room Altitude',
        host: '192.168.1.50',
        port: 44100,
        powered: false,
        activeSource: 'Blu-ray',
      },
      {
        id: 'theater-trinnov',
        name: 'Theater Altitude 32',
        host: '192.168.1.60',
        port: 44100,
        powered: true,
        activeSource: 'Theater Apple TV',
        volumeStepDb: 0.5,
      },
    ],
  },
  'discoveryFile',
);
assert.strictEqual(parsedDiscovery.targets.length, 2);
assert.strictEqual(parsedDiscovery.httpTargetsUrl, 'http://127.0.0.1:44180/api/cec/targets');

const extractedFromConfig = extractTrinnovTargetsFromHomebridgeConfig({
  platforms: [
    { platform: 'Pulse8AppleTvCec', name: 'CEC' },
    {
      platform: 'TrinnovAltitude',
      name: 'Theater Trinnov',
      host: '10.0.1.77',
      port: 44100,
      devices: [{ id: 'zone2', name: 'Lounge Trinnov', ip: '10.0.1.78' }],
    },
  ],
});
assert.strictEqual(extractedFromConfig.length, 2);
assert.strictEqual(extractedFromConfig[0].host, '10.0.1.77');
assert.strictEqual(extractedFromConfig[1].host, '10.0.1.78');

// 11. Test TrinnovTargetResolver priority, discovery file, HTTP refresh, and multi-processor matching
const tempDir = mkdtempSync(join(tmpdir(), 'pulse8-trinnov-test-'));
try {
  const discoveryFile = join(tempDir, TRINNOV_DISCOVERY_FILENAME);
  const hbConfigFile = join(tempDir, 'config.json');

  writeFileSync(
    hbConfigFile,
    JSON.stringify({
      platforms: [{ platform: 'Trinnov', host: '192.168.10.10' }],
    }),
  );

  // Fallback to Homebridge config.json when discovery file does not exist yet
  const resolver = new TrinnovTargetResolver(
    {
      mode: 'auto',
      storagePath: tempDir,
      configPath: hbConfigFile,
      volumeStepDb: 1,
      httpFetcher: async () =>
        JSON.stringify({
          processors: [
            {
              id: 'http-trinnov',
              name: 'HTTP Trinnov',
              host: '192.168.20.20',
              port: 44100,
              volumeStepDb: 0.5,
            },
          ],
        }),
    },
    silentLog,
  );
  resolver.refreshSync();
  const fromConfig = resolver.resolveForAppleTv({
    displayName: 'Theater Apple TV',
    osdString: 'Theater Apple TV',
  });
  assert.strictEqual(fromConfig?.target.host, '192.168.10.10');
  assert.strictEqual(fromConfig?.target.source, 'homebridgeConfig');

  // Write live discovery file from homebridge-trinnov -> takes precedence over config.json
  writeFileSync(
    discoveryFile,
    JSON.stringify({
      version: 1,
      plugin: 'homebridge-trinnov',
      http: { baseUrl: 'http://127.0.0.1:44180' },
      processors: [
        { id: 'alt1', name: 'Living', host: '192.168.1.50', powered: false, activeSource: 'Cable' },
        { id: 'alt2', name: 'Theater', host: '192.168.1.60', powered: true, activeSource: 'Theater Apple TV', volumeStepDb: 0.5 },
      ],
    }),
  );
  resolver.refreshSync();
  const fromFile = resolver.resolveForAppleTv({
    displayName: 'Theater Apple TV',
    osdString: 'Apple TV',
  });
  assert.strictEqual(fromFile?.target.host, '192.168.1.60');
  assert.strictEqual(fromFile?.target.source, 'discoveryFile');
  assert.strictEqual(fromFile?.stepDb, 0.5);

  // Per-Apple TV explicit override wins over everything
  const fromDeviceOverride = resolver.resolveForAppleTv({
    displayName: 'Theater Apple TV',
    osdString: 'Apple TV',
    deviceOverride: { trinnovHost: '10.10.10.10', trinnovPort: 44101, volumeStepDb: 1.5 },
  });
  assert.strictEqual(fromDeviceOverride?.target.host, '10.10.10.10');
  assert.strictEqual(fromDeviceOverride?.target.port, 44101);
  assert.strictEqual(fromDeviceOverride?.stepDb, 1.5);

  // HTTP refresh updates candidates
  await resolver.refreshHttp();
  const fromHttp = resolver.resolveForAppleTv({
    displayName: 'Theater Apple TV',
    osdString: 'Apple TV',
  });
  assert.strictEqual(fromHttp?.target.host, '192.168.20.20');
  assert.strictEqual(fromHttp?.target.source, 'discoveryHttp');

  // Disabled per-device returns null
  const disabledDevice = resolver.resolveForAppleTv({
    displayName: 'Bedroom',
    osdString: 'Bedroom',
    deviceOverride: { trinnovEnabled: false },
  });
  assert.strictEqual(disabledDevice, null);

  resolver.stop();

  // 11b. Test generalized TargetResolver scanning homebridge-cec-targets.json & homebridge-*-discovery.json
  const genericFile = join(tempDir, GENERIC_DISCOVERY_FILENAME);
  const anthemFile = join(tempDir, 'homebridge-anthem-discovery.json');
  writeFileSync(
    genericFile,
    JSON.stringify({
      version: 1,
      plugin: 'homebridge-custom-avr',
      targets: [
        {
          id: 'denon-living',
          name: 'Denon AVR',
          driver: 'tcp',
          host: '192.168.1.75',
          port: 23,
          powered: true,
          activeSource: 'Living Room Apple TV',
          tcpCommands: { volumeUp: 'MVUP', volumeDown: 'MVDOWN', mute: 'MUON', lineEnding: '\\r' },
        },
      ],
    }),
  );
  writeFileSync(
    anthemFile,
    JSON.stringify({
      version: 1,
      plugin: 'homebridge-anthem',
      targets: [
        {
          id: 'anthem-mrx',
          name: 'Anthem MRX',
          driver: 'tcp',
          host: '192.168.1.80',
          port: 14999,
          powered: true,
          activeSource: 'Theater Apple TV',
        },
      ],
    }),
  );

  const genericResolver = new TargetResolver({ mode: 'auto', storagePath: tempDir }, silentLog);
  genericResolver.refreshSync();
  const livingTarget = genericResolver.resolveForAppleTv({
    displayName: 'Living Room Apple TV',
    osdString: 'Living Room',
  });
  assert.strictEqual(livingTarget?.target.driver, 'tcp');
  assert.strictEqual(livingTarget?.target.host, '192.168.1.75');
  assert.strictEqual(livingTarget?.target.tcpCommands?.volumeUp, 'MVUP');

  const anthemTarget = genericResolver.resolveForAppleTv({
    displayName: 'Theater Apple TV',
    osdString: 'Theater',
  });
  assert.strictEqual(anthemTarget?.target.driver, 'tcp');
  assert.strictEqual(anthemTarget?.target.host, '192.168.1.80');
  assert.strictEqual(anthemTarget?.target.port, 14999);
  genericResolver.stop();

  // HTTP webhook mode without targetHost
  const webhookResolver = new TargetResolver(
    {
      mode: 'http',
      httpEndpoints: { volumeUp: 'http://192.168.1.90:8123/api/webhook/vol-up' },
    },
    silentLog,
  );
  const webhookTarget = webhookResolver.resolveForAppleTv({
    displayName: 'Apple TV',
    osdString: 'Apple TV',
  });
  assert.strictEqual(webhookTarget?.target.driver, 'http');
  assert.strictEqual(
    webhookTarget?.target.httpEndpoints?.volumeUp,
    'http://192.168.1.90:8123/api/webhook/vol-up',
  );
  webhookResolver.stop();
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

// 12. Test TrinnovTcpClient against an actual local mock Trinnov TCP 44100 server
const receivedLines = [];
let serverSocket = null;
const mockTrinnovServer = net.createServer((sock) => {
  serverSocket = sock;
  sock.write('Welcome on Trinnov Optimizer (Version 4.3.0, ID 999999)\n');
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx = buf.indexOf('\n');
    while (idx !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      receivedLines.push(line);
      if (line.startsWith('id ')) {
        sock.write('OK\n');
      } else if (line.startsWith('dvolume ') || line.startsWith('mute ')) {
        sock.write('OK\n');
      } else if (line === 'bye') {
        sock.write('BYE\n');
        sock.end();
      }
      idx = buf.indexOf('\n');
    }
  });
});

await new Promise((resolve) => mockTrinnovServer.listen(0, '127.0.0.1', resolve));
const { port: mockPort } = mockTrinnovServer.address();

const trinnovTcp = new TrinnovTcpClient(
  {
    host: '127.0.0.1',
    port: mockPort,
    clientId: 'homebridge-pulse8-appletv-cec',
    idleTimeoutMs: 5000,
    connectTimeoutMs: 1000,
  },
  silentLog,
);

// Queue volume up & down & mute while disconnected -> must handshake (`id ...`) then flush in order
trinnovTcp.adjustVolume(1);
trinnovTcp.adjustVolume(-0.5);
trinnovTcp.toggleMute();

await sleep(100);
assert.deepStrictEqual(receivedLines, [
  'id homebridge-pulse8-appletv-cec',
  'dvolume 1',
  'dvolume -0.5',
  'mute 2',
]);

// Subsequent command on warm socket executes immediately without re-handshaking
trinnovTcp.adjustVolume(0.5);
await sleep(50);
assert.deepStrictEqual(receivedLines, [
  'id homebridge-pulse8-appletv-cec',
  'dvolume 1',
  'dvolume -0.5',
  'mute 2',
  'dvolume 0.5',
]);

trinnovTcp.stop();
await sleep(50);
assert.ok(receivedLines.includes('bye'), 'Expected clean bye command on stop');

if (serverSocket && !serverSocket.destroyed) {
  serverSocket.destroy();
}
await new Promise((resolve) => mockTrinnovServer.close(resolve));

// Offline Trinnov port must drop failed queue and recover cleanly when reachable again
const closedPort = mockPort;
const offlineClient = new TrinnovTcpClient(
  {
    host: '127.0.0.1',
    port: closedPort,
    connectTimeoutMs: 300,
  },
  silentLog,
);
offlineClient.adjustVolume(1);
await sleep(80);
offlineClient.stop();

// 13. Test generic TcpTargetDriver (no handshake, \r line ending, template vars, and hex: binary payload)
const genericTcpChunks = [];
const mockGenericTcpServer = net.createServer((sock) => {
  sock.on('data', (chunk) => genericTcpChunks.push(chunk));
});
await new Promise((resolve) => mockGenericTcpServer.listen(0, '127.0.0.1', resolve));
const { port: genericPort } = mockGenericTcpServer.address();

const genericDriver = new TcpTargetDriver(
  {
    host: '127.0.0.1',
    port: genericPort,
    driverLabel: 'Anthem',
    idleTimeoutMs: 0,
    commands: {
      init: 'ECH0',
      volumeUp: 'Z1VUP {{stepDb}}',
      powerOff: 'hex:a5 5b 02 01',
      lineEnding: '\\r',
    },
  },
  silentLog,
);
genericDriver.sendAction('volumeUp', { stepDb: 1.5 });
await sleep(60);
genericDriver.sendAction('powerOff');
await sleep(40);
genericDriver.disconnect();
await new Promise((resolve) => mockGenericTcpServer.close(resolve));

const combinedGeneric = Buffer.concat(genericTcpChunks);
assert.ok(combinedGeneric.includes(Buffer.from('ECH0\rZ1VUP 1.5\r', 'utf8')));
assert.ok(combinedGeneric.includes(Buffer.from([0xa5, 0x5b, 0x02, 0x01])));

// 14. Test HttpTargetDriver (full URLs, relative URLs, GET/POST, headers, JSON body templates)
const httpRequests = [];
const httpDriver = new HttpTargetDriver(
  {
    host: '192.168.1.99',
    port: 8123,
    endpoints: {
      volumeUp: {
        url: '/api/webhook/vol-up',
        method: 'POST',
        headers: { 'X-Source': '{{source}}' },
        body: { step: '{{stepDb}}', action: '{{action}}' },
      },
      mute: 'http://10.0.0.5:8080/mute?src={{source}}',
    },
    fetcher: async (url, init) => {
      httpRequests.push({ url, ...init });
      return { ok: true, status: 200 };
    },
  },
  silentLog,
);
await httpDriver.sendAction('volumeUp', { stepDb: 2, sourceName: 'Theater' });
await httpDriver.sendAction('muteToggle', { sourceName: 'Theater' });
assert.strictEqual(httpRequests.length, 2);
assert.strictEqual(httpRequests[0].url, 'http://192.168.1.99:8123/api/webhook/vol-up');
assert.strictEqual(httpRequests[0].method, 'POST');
assert.strictEqual(httpRequests[0].headers['Content-Type'], 'application/json');
assert.strictEqual(httpRequests[0].headers['X-Source'], 'Theater');
assert.deepStrictEqual(JSON.parse(httpRequests[0].body), { step: '2', action: 'volumeUp' });
assert.strictEqual(httpRequests[1].url, 'http://10.0.0.5:8080/mute?src=Theater');

// 15. Test Pulse8AppleTvAccessory service lifecycle (OccupancySensor, Switch, Power Buttons, cached cleanup)
function makeMockHap() {
  class MockCharacteristic {
    constructor(name) {
      this.name = name;
      this.value = undefined;
      this.props = {};
      this.getHandler = null;
      this.setHandler = null;
    }
    setProps(p) {
      this.props = p;
      return this;
    }
    onGet(fn) {
      this.getHandler = fn;
      return this;
    }
    onSet(fn) {
      this.setHandler = fn;
      return this;
    }
    removeAllListeners(type) {
      if (type === 'get') this.getHandler = null;
      if (type === 'set') this.setHandler = null;
      return this;
    }
    updateValue(val) {
      this.value = val;
      return this;
    }
  }
  const Characteristic = {
    Name: 'Name',
    ConfiguredName: 'ConfiguredName',
    Manufacturer: 'Manufacturer',
    Model: 'Model',
    SerialNumber: 'SerialNumber',
    FirmwareRevision: 'FirmwareRevision',
    ServiceLabelNamespace: Object.assign('ServiceLabelNamespace', { ARABIC_NUMERALS: 1 }),
    ServiceLabelIndex: 'ServiceLabelIndex',
    ProgrammableSwitchEvent: Object.assign('ProgrammableSwitchEvent', { SINGLE_PRESS: 0, LONG_PRESS: 2 }),
    OccupancyDetected: Object.assign('OccupancyDetected', { OCCUPANCY_NOT_DETECTED: 0, OCCUPANCY_DETECTED: 1 }),
    On: 'On',
  };
  class MockService {
    constructor(displayName, subtype) {
      this.displayName = displayName;
      this.subtype = subtype;
      this.chars = new Map();
    }
    setCharacteristic(key, val) {
      this.getCharacteristic(key).updateValue(val);
      return this;
    }
    addOptionalCharacteristic(key) {
      this.getCharacteristic(key);
      return this;
    }
    testCharacteristic(key) {
      return this.chars.has(key);
    }
    getCharacteristic(key) {
      if (!this.chars.has(key)) {
        this.chars.set(key, new MockCharacteristic(key));
      }
      return this.chars.get(key);
    }
  }
  class AccessoryInformation extends MockService {}
  class ServiceLabel extends MockService {}
  class StatelessProgrammableSwitch extends MockService {}
  class OccupancySensor extends MockService {}
  class Switch extends MockService {}

  const Service = {
    AccessoryInformation,
    ServiceLabel,
    StatelessProgrammableSwitch,
    OccupancySensor,
    Switch,
  };

  class MockAccessory {
    constructor() {
      this.services = [new AccessoryInformation('Apple TV', undefined)];
    }
    getService(type) {
      return this.services.find((s) => s instanceof type);
    }
    getServiceById(type, subtype) {
      return this.services.find((s) => s instanceof type && s.subtype === subtype);
    }
    addService(svcOrType, name, subtype) {
      const svc = svcOrType instanceof MockService ? svcOrType : new svcOrType(name, subtype);
      this.services.push(svc);
      return svc;
    }
    removeService(svc) {
      const idx = this.services.indexOf(svc);
      if (idx !== -1) this.services.splice(idx, 1);
    }
  }

  return { Service, Characteristic, MockAccessory };
}

const hap = makeMockHap();
const mockAcc = new hap.MockAccessory();
const mockDevice = {
  logicalAddress: '4',
  logicalAddressNum: 4,
  deviceType: 'Playback',
  physicalAddress: '1.0.0.0',
  activeSource: true,
  vendor: 'Apple',
  osdString: 'Living Room',
  isAppleTv: true,
};
const mockPlatform = { Service: hap.Service, Characteristic: hap.Characteristic };

// Enable OccupancySensor + Power On/Off buttons
const accWithOcc = new Pulse8AppleTvAccessory(
  mockPlatform,
  mockAcc,
  mockDevice,
  'Living Room',
  '1.0.4',
  { powerSensorType: 'occupancy', includePowerButtons: true, initialPowerState: true },
);
assert.ok(mockAcc.getServiceById(hap.Service.OccupancySensor, 'cec-power-occupancy'));
assert.ok(mockAcc.getServiceById(hap.Service.StatelessProgrammableSwitch, 'cec-power-on'));
assert.ok(mockAcc.getServiceById(hap.Service.StatelessProgrammableSwitch, 'cec-power-off'));
assert.strictEqual(
  mockAcc.getServiceById(hap.Service.OccupancySensor, 'cec-power-occupancy')
    .getCharacteristic(hap.Characteristic.OccupancyDetected).value,
  hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
);
accWithOcc.setPowerState(false);
assert.strictEqual(
  mockAcc.getServiceById(hap.Service.OccupancySensor, 'cec-power-occupancy')
    .getCharacteristic(hap.Characteristic.OccupancyDetected).value,
  hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
);
accWithOcc.triggerKeyEvent('powerOn', 'single');
assert.strictEqual(
  mockAcc.getServiceById(hap.Service.StatelessProgrammableSwitch, 'cec-power-on')
    .getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent).value,
  hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
);

// Re-instantiate as Switch + no power buttons -> must clean up OccupancySensor and Power buttons!
let switchToggledTo = null;
const accWithSwitch = new Pulse8AppleTvAccessory(
  mockPlatform,
  mockAcc,
  mockDevice,
  'Living Room',
  '1.0.4',
  {
    powerSensorType: 'switch',
    includePowerButtons: false,
    onPowerSwitchSet: (on) => {
      switchToggledTo = on;
    },
  },
);
assert.strictEqual(mockAcc.getServiceById(hap.Service.OccupancySensor, 'cec-power-occupancy'), undefined);
assert.strictEqual(mockAcc.getServiceById(hap.Service.StatelessProgrammableSwitch, 'cec-power-on'), undefined);
assert.strictEqual(mockAcc.getServiceById(hap.Service.StatelessProgrammableSwitch, 'cec-power-off'), undefined);
const powerSwitchSvc = mockAcc.getServiceById(hap.Service.Switch, 'cec-power-switch');
assert.ok(powerSwitchSvc);
accWithSwitch.setPowerState(true);
assert.strictEqual(powerSwitchSvc.getCharacteristic(hap.Characteristic.On).value, true);
powerSwitchSvc.getCharacteristic(hap.Characteristic.On).setHandler(false);
assert.strictEqual(switchToggledTo, false);

// Re-instantiate as 'none' -> must clean up Switch too!
new Pulse8AppleTvAccessory(
  mockPlatform,
  mockAcc,
  mockDevice,
  'Living Room',
  '1.0.4',
  { powerSensorType: 'none', includePowerButtons: false },
);
assert.strictEqual(mockAcc.getServiceById(hap.Service.Switch, 'cec-power-switch'), undefined);
assert.strictEqual(mockAcc.getServiceById(hap.Service.OccupancySensor, 'cec-power-occupancy'), undefined);

// 16. Test broad Homebridge config.json autodetection (presets, cecTarget, custom plugin list, ignoring non-AV & self)
const broadExtracted = extractTargetsFromHomebridgeConfig(
  {
    platforms: [
      { platform: 'Pulse8AppleTvCec', host: '127.0.0.1' }, // must ignore self
      { platform: 'Hue', host: '192.168.1.2' }, // unrelated plugin -> ignored
      { platform: 'AnthemReceiver', name: 'Theater Anthem', ip: '192.168.1.30' },
      { platform: 'DenonHeos', name: 'Denon AVR', host: '192.168.1.31' },
      { platform: 'YamahaYXC', name: 'Patio Yamaha', ip: '192.168.1.32' },
      {
        platform: 'CustomNichePlugin',
        name: 'Preamp',
        host: '192.168.1.33',
        port: 5000,
        cecTarget: { id: 'niche-preamp', tcpCommands: { volumeUp: 'V+' } },
      },
      { platform: 'SuperSpecialPreamp', name: 'Studio', ipAddress: '192.168.1.34', port: 9000 },
    ],
    accessories: [
      { accessory: 'McIntoshControl', name: 'McIntosh Amp', host: '192.168.1.35', port: 84 },
    ],
  },
  { autodetectPlugins: ['SuperSpecialPreamp'] },
);

assert.strictEqual(broadExtracted.length, 6);
assert.strictEqual(broadExtracted[0].host, '192.168.1.30');
assert.strictEqual(broadExtracted[0].port, 14999);
assert.strictEqual(broadExtracted[0].tcpCommands?.volumeUp, 'Z1VUP;');

assert.strictEqual(broadExtracted[1].host, '192.168.1.31');
assert.strictEqual(broadExtracted[1].port, 23);
assert.strictEqual(broadExtracted[1].tcpCommands?.volumeUp, 'MVUP');

assert.strictEqual(broadExtracted[2].host, '192.168.1.32');
assert.strictEqual(broadExtracted[2].driver, 'http');
assert.strictEqual(broadExtracted[2].port, 80);
assert.ok(broadExtracted[2].httpEndpoints?.volumeUp);

assert.strictEqual(broadExtracted[3].id, 'niche-preamp');
assert.strictEqual(broadExtracted[3].tcpCommands?.volumeUp, 'V+');

assert.strictEqual(broadExtracted[4].host, '192.168.1.34');
assert.strictEqual(broadExtracted[4].port, 9000);

assert.strictEqual(broadExtracted[5].host, '192.168.1.35');
assert.strictEqual(broadExtracted[5].port, 84);

console.log('✅ All homebridge-pulse8-appletv-cec unit tests passed!');
