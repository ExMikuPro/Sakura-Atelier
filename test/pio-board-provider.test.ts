import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BoardCache, BoardCacheEntry, PioBoardProvider, parseBoards } from '../src/embedded/devices/pioBoards';
import { DeviceCatalog, searchDevices, DeviceProvider } from '../src/embedded/devices/provider';
import { buildDeviceList, defaultSection } from '../src/embedded/devices/deviceList';
import { DeviceFavorites } from '../src/embedded/devices/favorites';
import { RecentDevices } from '../src/embedded/devices/recents';
import type { SyncableStore } from '../src/embedded/devices/store';
import type { DeviceInfo } from '../src/embedded/devices/model';

// Sample taken from `pio boards --json-output` (PlatformIO Core 6.2.0).
const sample = fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/embedded/pio-boards.json'), 'utf8');
const installedSample = JSON.stringify(JSON.parse(sample).filter((b: { platform: string }) => b.platform === 'ststm32'));

function memoryCache(entry?: BoardCacheEntry): BoardCache & { entry?: BoardCacheEntry; writes: number } {
  const cache = { entry, writes: 0, read: async () => cache.entry, write: async (e: BoardCacheEntry) => { cache.entry = e; cache.writes++; } };
  return cache;
}
function runner(handlers: { all?: () => string; installed?: () => string } = {}) {
  const calls: string[][] = [];
  const run = async (_c: string, args: string[]) => { calls.push(args); const h = args.includes('--installed') ? handlers.installed ?? (() => installedSample) : handlers.all ?? (() => sample); return h(); };
  return { run, calls };
}
const options = (over: Partial<ConstructorParameters<typeof PioBoardProvider>[0]> & { run: ConstructorParameters<typeof PioBoardProvider>[0]['run'] }) => ({ resolvePio: async () => '/pio/bin/pio', cache: memoryCache(), cwd: '/tmp', now: () => 1000, ...over });

test('parses the official board list: ids come from PlatformIO, MCU and board stay distinct', () => {
  const boards = parseBoards(sample);
  assert.equal(boards.length, 10);
  const g071 = boards.find(b => b.id === 'nucleo_g071rb')!;
  assert.deepEqual([g071.name, g071.vendor, g071.mcu, g071.platform], ['Nucleo G071RB', 'ST', 'STM32G071RBT6', 'ststm32']);
  assert.ok(g071.frameworks!.includes('stm32cube') && g071.frameworks!.includes('arduino'));
  assert.equal(g071.kind, 'pio-board');
});

test('parsing drops junk, duplicates and unsafe ids, and rejects bad output', () => {
  const boards = parseBoards(JSON.stringify([{ id: 'a', name: 'A' }, { id: 'a', name: 'dup' }, { id: '../x' }, { id: 5 }, null, { id: 'ok', name: 'line\nbreak', frameworks: ['x', 3] }]) + '\nIf you like PlatformIO, please star it');
  assert.deepEqual(boards.map(b => b.id), ['a', 'ok']);
  assert.equal(boards[1].name, 'line break'); assert.deepEqual(boards[1].frameworks, ['x']);
  assert.throws(() => parseBoards('not json'), /not valid JSON/);
  assert.throws(() => parseBoards('{"a":1}'), /unexpected board list/);
});

test('first load queries the CLI once, marks installed platforms and caches the result', async () => {
  const { run, calls } = runner(); const cache = memoryCache();
  const result = await new PioBoardProvider(options({ run, cache })).load();
  assert.equal(result.status.state, 'ready'); assert.equal(calls.length, 2);
  assert.equal(result.devices.find(d => d.id === 'nucleo_g071rb') && (result.devices.find(d => d.id === 'nucleo_g071rb') as { installed?: boolean }).installed, true);
  assert.equal((result.devices.find(d => d.id === 'uno') as { installed?: boolean }).installed, false);
  assert.equal(cache.writes, 1); assert.equal(cache.entry?.source, '/pio/bin/pio');
});

test('a fresh cache is used without running PlatformIO, and typing in search never reaches it', async () => {
  const { run, calls } = runner(); const cache = memoryCache({ source: '/pio/bin/pio', fetchedAt: 900, boards: parseBoards(sample) });
  const catalog = new DeviceCatalog([new PioBoardProvider(options({ run, cache }))]);
  await catalog.load(); await catalog.load();
  for (const q of ['n', 'nu', 'nuc', 'nucl', 'nucleo', 'nucleo g', 'nucleo g0', 'nucleo g07', 'nucleo g071']) { searchDevices(catalog.snapshot().devices, q); }
  assert.equal(calls.length, 0);
});

test('an expired cache is shown immediately and refreshed in the background', async () => {
  const { run, calls } = runner(); const cache = memoryCache({ source: '/pio/bin/pio', fetchedAt: 0, boards: parseBoards(sample).slice(0, 2) });
  let updated: number | undefined; let notify!: () => void; const done = new Promise<void>(r => { notify = r; });
  const provider = new PioBoardProvider(options({ run, cache, now: () => 10 * 24 * 3600 * 1000, onUpdate: r => { updated = r.devices.length; notify(); } }));
  const first = await provider.load();
  assert.equal(first.devices.length, 2); assert.deepEqual(first.status, { state: 'ready', stale: true, note: 'Refreshing in the background.' });
  await done; assert.equal(updated, 10); assert.equal(calls.length, 2);
});

test('manual reload bypasses a fresh cache; concurrent loads share one query', async () => {
  const { run, calls } = runner(); const cache = memoryCache({ source: '/pio/bin/pio', fetchedAt: 999, boards: parseBoards(sample) });
  const provider = new PioBoardProvider(options({ run, cache }));
  await Promise.all([provider.load({ refresh: true }), provider.load({ refresh: true })]);
  assert.equal(calls.filter(a => !a.includes('--installed')).length, 1);
});

test('PlatformIO not installed: unavailable without a cache, last known list with one', async () => {
  const { run, calls } = runner();
  const none = await new PioBoardProvider(options({ run, resolvePio: async () => undefined })).load();
  assert.deepEqual(none.status, { state: 'unavailable', reason: 'no-cli' }); assert.deepEqual(none.devices, []);
  const cached = await new PioBoardProvider(options({ run, resolvePio: async () => undefined, cache: memoryCache({ source: '/pio/bin/pio', fetchedAt: 1, boards: parseBoards(sample) }) })).load();
  assert.equal(cached.devices.length, 10); assert.equal(cached.status.state, 'ready'); assert.equal(calls.length, 0);
});

test('CLI failures and bad JSON are reported; an existing list is kept instead of lost', async () => {
  const failing = runner({ all: () => { throw new Error('pio: command not found'); } });
  const failed = await new PioBoardProvider(options({ run: failing.run })).load();
  assert.deepEqual(failed.status, { state: 'unavailable', reason: 'cli-failed', detail: 'pio: command not found' });
  const garbled = await new PioBoardProvider(options({ run: runner({ all: () => 'Traceback...' }).run })).load();
  assert.equal(garbled.status.state === 'unavailable' && garbled.status.reason, 'bad-output');
  const keep = await new PioBoardProvider(options({ run: failing.run, cache: memoryCache({ source: '/pio/bin/pio', fetchedAt: 0, boards: parseBoards(sample) }) })).load({ refresh: true });
  assert.equal(keep.devices.length, 10); assert.equal(keep.status.state === 'ready' && keep.status.stale, true);
});

test('an empty list is reported, platforms that are not installed yet leave installed state unknown', async () => {
  const empty = await new PioBoardProvider(options({ run: runner({ all: () => '[]' }).run })).load();
  assert.equal(empty.status.state === 'unavailable' && empty.status.reason, 'empty');
  const noInstalledInfo = await new PioBoardProvider(options({ run: runner({ installed: () => { throw new Error('offline'); } }).run })).load();
  assert.equal(noInstalledInfo.devices.length, 10); assert.equal((noInstalledInfo.devices[0] as { installed?: boolean }).installed, undefined);
});

test('a cache made by another PlatformIO Core installation is not trusted', async () => {
  const { run, calls } = runner(); const cache = memoryCache({ source: '/other/pio', fetchedAt: 999, boards: [] });
  await new PioBoardProvider(options({ run, cache })).load();
  assert.equal(calls.length, 2); assert.equal(cache.entry?.source, '/pio/bin/pio');
});

test('search covers id, name, vendor, MCU, platform and framework, ranks exact ids first, and ANDs the terms', () => {
  const boards = parseBoards(sample);
  const ids = (q: string) => searchDevices(boards, q).map(b => b.id);
  assert.equal(ids('nucleo_g071rb')[0], 'nucleo_g071rb');
  assert.ok(ids('STM32G071').includes('nucleo_g071rb'));
  assert.ok(ids('espressif').includes('esp32dev')); assert.ok(ids('rp2040').length >= 0);
  assert.ok(ids('ststm32 arduino').includes('nucleo_f401re') && !ids('ststm32 arduino').includes('uno'));
  assert.deepEqual(ids('zzzz'), []);
  assert.equal(searchDevices(boards, '').length, boards.length);
});

test('the list opens on favorites, then recents, then PlatformIO boards', () => {
  assert.equal(defaultSection([1], [1]), 'favorites'); assert.equal(defaultSection([], [1]), 'recent'); assert.equal(defaultSection([], []), 'pio-board');
});

function store(): SyncableStore { const d: Record<string, unknown> = {}; return { get: <T>(k: string, f: T) => (k in d ? d[k] as T : f), update: async (k, v) => { d[k] = JSON.parse(JSON.stringify(v)); } }; }

test('favorites stay in the list, with a reason, when PlatformIO or the board is unavailable', async () => {
  const s = store(); const favorites = new DeviceFavorites(s);
  await favorites.add({ kind: 'pio-board', id: 'nucleo_g071rb', name: 'Nucleo G071RB' }); await favorites.add({ kind: 'pio-board', id: 'gone_board', name: 'Gone' });
  const status = new Map([['pio-board' as const, { state: 'ready' as const }]]);
  const ready = buildDeviceList({ devices: parseBoards(sample), status, favorites: favorites.list(), recents: [] });
  assert.deepEqual(ready.map(r => [r.device.id, r.availability.state]), [['gone_board', 'not-in-catalog'], ['nucleo_g071rb', 'ok']]);
  assert.ok(ready.every(r => r.favorite));
  const down = buildDeviceList({ devices: [], status: new Map([['pio-board' as const, { state: 'unavailable' as const, reason: 'no-cli' as const }]]), favorites: favorites.list(), recents: [] });
  assert.deepEqual(down.map(r => [r.device.name, r.availability.state]), [['Gone', 'toolchain-missing'], ['Nucleo G071RB', 'toolchain-missing']]);
  assert.equal(favorites.list().length, 2, 'nothing was deleted');
});

test('sections: recents keep order, the star state is shown everywhere, MCU and board of the same chip are separate rows', async () => {
  const s = store(); const favorites = new DeviceFavorites(s); const recents = new RecentDevices(s, (() => { let t = 1; return () => t++; })());
  await recents.record({ kind: 'pio-board', id: 'uno', name: 'Uno' }); await recents.record({ kind: 'pio-board', id: 'nucleo_g071rb', name: 'Nucleo G071RB' });
  await favorites.add({ kind: 'pio-board', id: 'uno', name: 'Uno' });
  const devices: DeviceInfo[] = [...parseBoards(sample), { kind: 'stm32-mcu', id: 'STM32G071RBTx', name: 'STM32G071RBTx' }, { kind: 'stm32-board', id: 'NUCLEO-G071RB', name: 'NUCLEO-G071RB' }];
  const status = new Map<'pio-board' | 'stm32-mcu' | 'stm32-board', { state: 'ready' }>([['pio-board', { state: 'ready' }], ['stm32-mcu', { state: 'ready' }], ['stm32-board', { state: 'ready' }]]);
  const input = { devices, status, favorites: favorites.list(), recents: recents.list() };
  assert.deepEqual(buildDeviceList({ ...input, section: 'recent' }).map(r => r.device.id), ['nucleo_g071rb', 'uno']);
  assert.equal(buildDeviceList({ ...input, section: 'recent' }).find(r => r.device.id === 'uno')!.favorite, true);
  assert.deepEqual(buildDeviceList({ ...input, section: 'all', query: 'g071rb' }).map(r => `${r.device.kind}:${r.device.id}`).sort(), ['pio-board:nucleo_g071rb', 'stm32-board:NUCLEO-G071RB', 'stm32-mcu:STM32G071RBTx']);
  assert.deepEqual(buildDeviceList({ ...input, section: 'stm32-mcu' }).map(r => r.device.id), ['STM32G071RBTx']);
});

test('the catalog survives a provider that throws', async () => {
  const bad: DeviceProvider = { id: 'bad', label: 'Bad', kinds: ['stm32-mcu'], load: async () => { throw new Error('boom'); } };
  const catalog = new DeviceCatalog([bad]); await catalog.load();
  assert.equal(catalog.snapshot().status.get('stm32-mcu')?.state, 'unavailable');
});

test('official CLI output parses (set SAKURA_TEST_PIO to run)', { skip: !process.env.SAKURA_TEST_PIO }, async () => {
  const { nodeRunner } = await import('../src/embedded/process');
  const boards = parseBoards(await nodeRunner(process.env.SAKURA_TEST_PIO!, ['boards', '--json-output'], process.cwd(), 120000));
  assert.ok(boards.length > 100); assert.ok(boards.some(b => b.id === 'nucleo_g071rb'));
});
