import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AdapterRegistry, Registry, registerBuiltinDescriptors } from '../src/adapterRegistry';
import type { BackendHost, ProjectBackend } from '../src/adapterTypes';

const host: BackendHost = { readDir: async () => ['marker.txt'], readText: async () => '' };
const backend = (id: string, result: 'hit' | 'miss' | 'throw'): ProjectBackend => ({
  id, label: id,
  detect: async root => {
    if (result === 'throw') { throw new Error('unreadable'); }
    return result === 'hit' ? { backend: id, root, marker: 'marker.txt', buildSystem: 'x', languages: ['c'], runTargets: ['host'], details: {} } : undefined;
  }
});

test('registry rejects duplicates and supports disposal', () => {
  const registry = new Registry<string, number>('Thing');
  const handle = registry.register('a', 1);
  assert.throws(() => registry.register('a', 2), /already registered/);
  assert.equal(registry.get('a'), 1);
  handle.dispose();
  assert.equal(registry.has('a'), false);
  registry.register('a', 3);
  assert.equal(registry.get('a'), 3);
});

test('a stale disposable does not remove a newer registration', () => {
  const registry = new Registry<string, number>('Thing');
  const first = registry.register('a', 1); first.dispose();
  registry.register('a', 2); first.dispose();
  assert.equal(registry.get('a'), 2);
});

test('builtin descriptors are registered once and keep host as the default target', () => {
  const registry = new AdapterRegistry();
  registerBuiltinDescriptors(registry);
  assert.ok(registry.buildSystems.has('cmake') && registry.buildSystems.has('cargo'));
  assert.equal(registry.runTargets.get('host')?.kind, 'host');
  assert.throws(() => registerBuiltinDescriptors(registry), /already registered/);
});

test('backend detection returns hits and isolates failures', async () => {
  const registry = new AdapterRegistry();
  registry.backends.register('a', backend('a', 'hit'));
  registry.backends.register('b', backend('b', 'throw'));
  registry.backends.register('c', backend('c', 'miss'));
  registry.backends.register('d', backend('d', 'hit'));
  const found = await registry.detectBackendProjects('/p', host);
  assert.deepEqual(found.map(p => p.backend), ['a', 'd']);
});

test('language, build system, run target and backend registries are independent', () => {
  const registry = new AdapterRegistry();
  registry.backends.register('same', backend('same', 'miss'));
  registry.runTargets.register('same', { id: 'same', label: 's', kind: 'device' });
  registry.buildSystems.register('same', { id: 'same', label: 's', markers: [] });
  assert.equal(registry.languages.size, 0);
});
