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
import { matchesAppleTvFilter } from './dist/platform.js';
import { sanitizeHomeKitName } from './dist/platformAccessory.js';
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
assert.strictEqual(schema.schema.properties.trinnovControl.default, 'auto');
assert.strictEqual(schema.schema.properties.trinnovPort.default, 44100);

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

// 6. Test CEC protocol replies, non-spam on 84, ignored power keys, and initial null power state
const sentCommands = [];
const keyEvents = [];
const volumeCommands = [];
const client = new Pulse8CecClient(
  {
    holdMode: 'longPress',
    holdDelayMs: 80,
    holdRepeatMs: 35,
    holdSafetyMs: 250,
    rawSender: (cmd) => sentCommands.push(cmd),
  },
  silentLog,
);
client.on('keyPress', (evt) => keyEvents.push(evt));
client.on('volumeCommand', (evt) => volumeCommands.push(evt));

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

// Standby from null initial state should still transition to false
client.handleLine('TRAFFIC: [10] >> 8f:36');
assert.strictEqual(client.getBusPowerState('8'), false);

// Active Source transitions to true & re-asserts System Audio Mode
client.handleLine('TRAFFIC: [11] >> 8f:82');
assert.strictEqual(client.getBusPowerState('8'), true);
assert.deepStrictEqual(sentCommands, ['tx 5F:72:01']);
sentCommands.length = 0;

// Protocol status queries from dynamic initiator '8'
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

// Power buttons (44:40 and 44:6c) must be ignored
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

console.log('✅ All homebridge-pulse8-appletv-cec unit tests passed!');
