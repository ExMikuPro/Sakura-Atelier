import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { fsHost } from './support/fsHost';
import { parseManualDevice, platformioBoardId, scanIocDevices, stm32Series, Stm32WorkspaceProvider } from '../src/embedded/devices/stm32Devices';
import { DeviceCatalog, DeviceProvider, searchDevices } from '../src/embedded/devices/provider';
import { DeviceFavorites } from '../src/embedded/devices/favorites';
import { buildDeviceList } from '../src/embedded/devices/deviceList';
import { deviceKey, normalizeDeviceId } from '../src/embedded/devices/model';
import type { SyncableStore } from '../src/embedded/devices/store';

const fixtures = path.resolve(__dirname, '../../test/fixtures/embedded');

test('the series is read from the name and nothing else is decoded', () => {
  assert.equal(stm32Series('STM32G0B1RETx'), 'STM32G0'); assert.equal(stm32Series('stm32f407vgt6'), 'STM32F4');
  assert.equal(stm32Series('STM32WB55RGV6'), 'STM32WB'); assert.equal(stm32Series('STM32MP157'), 'STM32MP1');
  assert.equal(stm32Series('NUCLEO-G071RB'), undefined);
});

test('MCU and ST board are different entities: STM32G0B1RE is a chip, NUCLEO-G071RB a board, nucleo_g071rb a PlatformIO board', () => {
  assert.equal(parseManualDevice('stm32-mcu', 'STM32G0B1RE').device?.kind, 'stm32-mcu');
  assert.match(parseManualDevice('stm32-mcu', 'NUCLEO-G071RB').error ?? '', /not an STM32 part number/);
  assert.equal(parseManualDevice('stm32-board', 'nucleo-g071rb').device?.id, 'NUCLEO-G071RB');
  assert.match(parseManualDevice('stm32-board', 'STM32G0B1RETx').error ?? '', /looks like an MCU/);
  assert.match(parseManualDevice('stm32-mcu', 'ESP32').error ?? '', /not an STM32/);
  assert.match(parseManualDevice('stm32-mcu', '../etc').error ?? '', /not an STM32/);
  assert.equal(platformioBoardId({ kind: 'stm32-mcu', id: 'STM32G0B1RETx' }), undefined);
  assert.equal(platformioBoardId({ kind: 'stm32-board', id: 'NUCLEO-G071RB' }), undefined);
  assert.equal(platformioBoardId({ kind: 'pio-board', id: 'nucleo_g071rb' }), 'nucleo_g071rb');
  assert.equal(normalizeDeviceId('stm32-mcu', 'nucleo_g071rb'), undefined);
});

test('a hand-typed MCU can be starred once and then lives in favorites without any provider data', async () => {
  const data: Record<string, unknown> = {}; const store: SyncableStore = { get: <T>(k: string, f: T) => (k in data ? data[k] as T : f), update: async (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } };
  const favorites = new DeviceFavorites(store); const device = parseManualDevice('stm32-mcu', 'STM32G0B1RETx').device!;
  await favorites.toggle(device);
  const rows = buildDeviceList({ devices: [], status: new Map([['stm32-mcu' as const, { state: 'ready' as const }]]), favorites: favorites.list(), recents: [], section: 'favorites' });
  assert.deepEqual(rows.map(r => [r.device.id, r.favorite, r.availability.state]), [['STM32G0B1RETx', true, 'not-in-catalog']]);
});

test('fixture: a CubeMX project without a board yields its MCU only ("custom" is not a board)', async () => {
  const devices = await scanIocDevices(path.join(fixtures, 'stm32-cubemx'), fsHost);
  assert.deepEqual(devices.map(d => `${d.kind}:${d.id}`), ['stm32-mcu:STM32G0B1RETx']);
  assert.equal(devices[0].family, 'STM32G0');
});

test('fixture: a project created from a board yields the board and its MCU as two linked entities', async () => {
  const devices = await scanIocDevices(path.join(fixtures, 'stm32-cubemx-board'), fsHost);
  assert.deepEqual(devices.map(d => `${d.kind}:${d.id}`), ['stm32-board:NUCLEO-G071RB', 'stm32-mcu:STM32G071RBTx']);
  assert.equal(devices.find(d => d.kind === 'stm32-board')!.mcu, 'STM32G071RBTx');
});

test('scan is bounded: it ignores build output and dependency folders and reads files only', async () => {
  const seen: string[] = [];
  const host = { readDir: async (d: string) => { seen.push(d); return d.endsWith('root') ? ['node_modules', 'build', 'src', '.git', 'a.ioc'] : d.endsWith('src') ? ['b.ioc'] : []; }, readText: async (f: string) => f.endsWith('a.ioc') ? 'Mcu.UserName=STM32F407VGTx\n' : f.endsWith('b.ioc') ? 'Mcu.UserName=STM32L476RGTx\nboard=NUCLEO-L476RG\n' : undefined };
  const devices = await scanIocDevices('/root', host);
  assert.deepEqual(seen.sort(), ['/root', '/root/src']);
  assert.deepEqual(devices.map(d => d.id), ['NUCLEO-L476RG', 'STM32F407VGTx', 'STM32L476RGTx']);
});

test('the workspace provider is ready with a hint when there are no .ioc files, and combines several roots without duplicates', async () => {
  const empty = await new Stm32WorkspaceProvider(() => [path.join(fixtures, 'plain-c')], fsHost).load();
  assert.equal(empty.status.state, 'ready'); assert.equal(empty.devices.length, 0);
  assert.match(empty.status.state === 'ready' ? empty.status.note ?? '' : '', /manually/);
  const both = await new Stm32WorkspaceProvider(() => [path.join(fixtures, 'stm32-cubemx'), path.join(fixtures, 'stm32-cubemx-board'), path.join(fixtures, 'stm32-cubemx')], fsHost).load();
  assert.deepEqual(both.devices.map(deviceKey), ['stm32-mcu:STM32G0B1RETX', 'stm32-board:NUCLEO-G071RB', 'stm32-mcu:STM32G071RBTX']);
});

test('MCU search finds by part, family and board name without touching any tool', async () => {
  const devices = await scanIocDevices(path.join(fixtures, 'stm32-cubemx-board'), fsHost);
  assert.deepEqual(searchDevices(devices, 'g071').map(d => d.id).sort(), ['NUCLEO-G071RB', 'STM32G071RBTx']);
  // A board also matches by the MCU it carries; the MCU does not match by board name.
  assert.deepEqual(searchDevices(devices, 'stm32g0').map(d => d.id).sort(), ['NUCLEO-G071RB', 'STM32G071RBTx']);
  assert.deepEqual(searchDevices(devices, 'nucleo').map(d => d.id), ['NUCLEO-G071RB']);
});

test('another vendor can be added as a provider without changing existing ones, and ids cannot be registered twice', async () => {
  const catalog = new DeviceCatalog([new Stm32WorkspaceProvider(() => [path.join(fixtures, 'stm32-cubemx')], fsHost)]);
  const other: DeviceProvider = { id: 'other-vendor', label: 'Other', kinds: ['stm32-mcu'], load: async () => ({ devices: [{ kind: 'stm32-mcu', id: 'STM32X000', name: 'X' }], status: { state: 'ready' } }) };
  await catalog.load(); catalog.add(other);
  assert.throws(() => catalog.add(other), /already registered/);
  await catalog.load();
  assert.deepEqual(catalog.snapshot().devices.map(d => d.id).sort(), ['STM32G0B1RETx', 'STM32X000']);
});
