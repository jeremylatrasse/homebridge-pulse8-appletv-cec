import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { Pulse8CecClient, parseScanOutput, parseTrafficFrame } from './dist/cecClient.js';
import { matchesAppleTvFilter } from './dist/platform.js';
import { sanitizeHomeKitName } from './dist/platformAccessory.js';

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

// 2. Test sanitizeHomeKitName
assert.strictEqual(sanitizeHomeKitName('Living Room (Apple TV)'), 'Living Room Apple TV');

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
const client = new Pulse8CecClient(
  {
    holdMode: 'longPress',
    holdDelayMs: 80,
    holdSafetyMs: 250,
    rawSender: (cmd) => sentCommands.push(cmd),
  },
  silentLog,
);
client.on('keyPress', (evt) => keyEvents.push(evt));

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

// Mute press
client.handleLine('TRAFFIC: [19] >> 85:44:43');
assert.strictEqual(keyEvents.length, 1);
assert.strictEqual(keyEvents[0].logicalAddress, '8');
assert.strictEqual(keyEvents[0].key, 'mute');
assert.strictEqual(keyEvents[0].pressType, 'single');

// 7. Test longPress mode: short tap (< 80ms) -> single press on release
keyEvents.length = 0;
client.handleLine('TRAFFIC: [20] >> 85:44:41');
await sleep(25);
client.handleLine('TRAFFIC: [21] >> 85:45');
assert.strictEqual(keyEvents.length, 1);
assert.strictEqual(keyEvents[0].key, 'volumeUp');
assert.strictEqual(keyEvents[0].pressType, 'single');

// 8. Test longPress mode: hold (>= 80ms) -> long press once, nothing extra on release
keyEvents.length = 0;
client.handleLine('TRAFFIC: [22] >> 85:44:42');
await sleep(110);
client.handleLine('TRAFFIC: [23] >> 85:45');
assert.strictEqual(keyEvents.length, 1);
assert.strictEqual(keyEvents[0].key, 'volumeDown');
assert.strictEqual(keyEvents[0].pressType, 'long');

// 9. Test repeat mode: immediate single + repeats until release
const repeatEvents = [];
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
repeatClient.handleLine('TRAFFIC: [30] >> 45:44:41');
await sleep(115);
repeatClient.handleLine('TRAFFIC: [31] >> 45:45');
const countAtRelease = repeatEvents.length;
assert.ok(countAtRelease >= 2, `Expected >=2 repeat ticks, got ${countAtRelease}`);
assert.ok(repeatEvents.every((e) => e.key === 'volumeUp' && e.pressType === 'single'));
await sleep(80);
assert.strictEqual(repeatEvents.length, countAtRelease, 'Repeat timer must stop after 45 release');

client.stop();
repeatClient.stop();

console.log('✅ All homebridge-pulse8-appletv-cec unit tests passed!');
