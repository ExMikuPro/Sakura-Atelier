import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DeviceFavorites, migrateLegacy } from '../src/embedded/devices/favorites';
import { RecentDevices } from '../src/embedded/devices/recents';
import { deviceKey, normalizeDeviceId, normalizeRef } from '../src/embedded/devices/model';
import { enableSettingsSync, favoriteDevicesKey, recentDevicesKey, syncedKeys, SyncableStore } from '../src/embedded/devices/store';

function memory(initial: Record<string, unknown> = {}): SyncableStore & { data: Record<string, unknown>; synced: string[]; writes: number } {
  const store = { data: { ...initial }, synced: [] as string[], writes: 0,
    get: <T>(key: string, fallback: T) => (key in store.data ? store.data[key] as T : fallback),
    update: async (key: string, value: unknown) => { store.writes++; store.data[key] = JSON.parse(JSON.stringify(value)); },
    setKeysForSync(keys: readonly string[]) { store.synced = [...keys]; } };
  return store;
}
const g071rb = { kind: 'pio-board' as const, id: 'nucleo_g071rb', name: 'ST Nucleo G071RB' };
const mcu = { kind: 'stm32-mcu' as const, id: 'STM32G0B1RETx', name: 'STM32G0B1RETx' };
const board = { kind: 'stm32-board' as const, id: 'NUCLEO-G071RB', name: 'NUCLEO-G071RB' };

test('the star saves immediately and clicking again removes, with no separate apply step', async () => {
  const store = memory(); const favorites = new DeviceFavorites(store, () => 1);
  assert.equal(await favorites.toggle(g071rb), true);
  assert.equal(store.writes, 1); assert.ok(favorites.isFavorite(g071rb));
  assert.equal(await favorites.toggle(g071rb), false);
  assert.equal(favorites.isFavorite(g071rb), false); assert.equal(store.writes, 2);
});

test('favorites persist across instances and workspaces because they live in globalState, not in the project', async () => {
  const store = memory();
  await new DeviceFavorites(store).add(g071rb);
  const otherWorkspace = new DeviceFavorites(store);
  assert.deepEqual(otherWorkspace.list().map(deviceKey), ['pio-board:nucleo_g071rb']);
  assert.deepEqual(Object.keys(store.data), [favoriteDevicesKey]);
  assert.equal(favoriteDevicesKey, 'sakuraAtelier.favoriteDevices');
});

test('duplicates collapse, including the same id in different case for case-insensitive kinds', async () => {
  const store = memory(); const favorites = new DeviceFavorites(store);
  await favorites.add(mcu); await favorites.add({ ...mcu, id: 'stm32g0b1retx' }); await favorites.add(mcu);
  assert.equal(favorites.list().length, 1);
  const seeded = new DeviceFavorites(memory({ [favoriteDevicesKey]: { version: 2, items: [{ ...g071rb, addedAt: 1 }, { ...g071rb, addedAt: 2 }, { kind: 'pio-board', id: 'nucleo_g071rb' }] } }));
  assert.equal(seeded.list().length, 1);
});

test('the same name under different kinds never collides: MCU, ST board and PlatformIO board stay separate', async () => {
  const favorites = new DeviceFavorites(memory());
  await favorites.add({ kind: 'pio-board', id: 'nucleo_g071rb' }); await favorites.add(board); await favorites.add(mcu);
  assert.deepEqual(favorites.list().map(deviceKey).sort(), ['pio-board:nucleo_g071rb', 'stm32-board:NUCLEO-G071RB', 'stm32-mcu:STM32G0B1RETX']);
  assert.equal(normalizeDeviceId('pio-board', 'STM32G0B1RETx'), 'STM32G0B1RETx', 'shape alone is allowed for a PlatformIO id');
  assert.equal(normalizeDeviceId('stm32-mcu', 'NUCLEO-G071RB'), undefined, 'a board name is never accepted as an MCU');
  assert.equal(normalizeDeviceId('stm32-mcu', 'nucleo_g071rb'), undefined);
  await favorites.remove(board);
  assert.ok(favorites.isFavorite(mcu) && favorites.isFavorite({ kind: 'pio-board', id: 'nucleo_g071rb' }));
});

test('legacy lists (plain strings, optional prefix) are migrated and rewritten once', async () => {
  assert.deepEqual(migrateLegacy('nucleo_g071rb'), { kind: 'pio-board', id: 'nucleo_g071rb' });
  assert.deepEqual(migrateLegacy('STM32G0B1RETx'), { kind: 'stm32-mcu', id: 'STM32G0B1RETx' });
  assert.deepEqual(migrateLegacy('board:nucleo-g071rb'), { kind: 'stm32-board', id: 'NUCLEO-G071RB' });
  assert.deepEqual(migrateLegacy('pio:uno'), { kind: 'pio-board', id: 'uno' });
  assert.equal(migrateLegacy('../../etc/passwd'), undefined);
  const store = memory({ [favoriteDevicesKey]: ['uno', 'STM32G0B1RETx', 'uno', 'bad path', 5] });
  const favorites = new DeviceFavorites(store);
  assert.deepEqual(favorites.list().map(deviceKey), ['pio-board:uno', 'stm32-mcu:STM32G0B1RETX']);
  await favorites.migrate();
  assert.equal((store.data[favoriteDevicesKey] as { version: number }).version, 2);
  const writes = store.writes; await favorites.migrate(); assert.equal(store.writes, writes, 'already current: no rewrite');
});

test('corrupt stored data never throws and never leaks into the list', () => {
  for (const bad of [null, 5, 'x', {}, { items: 'no' }, [{}, null, { kind: 'x', id: 'y' }, { kind: 'pio-board', id: '/abs/path' }, { kind: 'pio-board', id: 'a\nb' }]]) {
    assert.deepEqual(new DeviceFavorites(memory({ [favoriteDevicesKey]: bad })).list(), [], JSON.stringify(bad));
  }
});

test('machine-specific values cannot be stored as device ids', async () => {
  for (const id of ['/dev/ttyACM0', 'C:\\Users\\me\\sdk', '~/sdk', 'COM3 ', '../x', 'a/b']) { assert.deepEqual(normalizeRef({ kind: 'pio-board', id }), id === 'COM3 ' ? { kind: 'pio-board', id: 'COM3' } : undefined, id); }
  await assert.rejects(new DeviceFavorites(memory()).add({ kind: 'pio-board', id: '/dev/ttyACM0' }), /valid device identifier/);
});

test('only favorites and favorite templates sync, never recents or anything machine specific', () => {
  const store = memory(); enableSettingsSync(store);
  assert.deepEqual(store.synced, ['sakuraAtelier.favoriteDevices', 'sakuraAtelier.favoriteTemplates']);
  assert.ok(!syncedKeys.includes(recentDevicesKey));
  enableSettingsSync({ get: <T>(_: string, f: T) => f, update: async () => undefined });
});

test('recents keep newest first, move a reused device to the front and are capped', async () => {
  let clock = 100; const recents = new RecentDevices(memory(), () => clock++);
  await recents.record(g071rb); await recents.record(mcu); await recents.record(board); await recents.record(g071rb);
  assert.deepEqual(recents.list().map(deviceKey), ['pio-board:nucleo_g071rb', 'stm32-board:NUCLEO-G071RB', 'stm32-mcu:STM32G0B1RETX']);
  for (let i = 0; i < 30; i++) { await recents.record({ kind: 'pio-board', id: `board${i}` }); }
  assert.equal(recents.list().length, 20); assert.equal(recents.list()[0].id, 'board29');
});

test('recents order is stable even if the clock does not advance', async () => {
  const recents = new RecentDevices(memory(), () => 5);
  await recents.record(g071rb); await recents.record(mcu);
  assert.deepEqual(recents.list().map(r => r.id), ['STM32G0B1RETx', 'nucleo_g071rb']);
  assert.equal(deviceKey({ kind: 'stm32-mcu', id: 'STM32G0B1RETx' }), deviceKey({ kind: 'stm32-mcu', id: 'stm32g0b1retx' }));
});

test('clearing recents leaves favorites alone, and starring does not record a recent', async () => {
  const store = memory(); const favorites = new DeviceFavorites(store); const recents = new RecentDevices(store);
  await favorites.toggle(g071rb);
  assert.deepEqual(recents.list(), []);
  await recents.record(g071rb); await recents.clear();
  assert.deepEqual(recents.list(), []); assert.ok(favorites.isFavorite(g071rb));
});
