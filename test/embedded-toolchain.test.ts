import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fakeHost } from './support/fakeHost';
import { discoverEmbeddedTools, normalizeManualPath, cltComponents } from '../src/embedded/toolchainDiscovery';
import { EmbeddedToolRegistry, embeddedToolsKey, KeyValueStore } from '../src/embedded/toolRegistry';

const cltFiles = (root: string, exeSuffix = '', sep = '/') => [
  `GNU-tools-for-STM32/bin/arm-none-eabi-gcc${exeSuffix}`, `GNU-tools-for-STM32/bin/arm-none-eabi-gdb${exeSuffix}`,
  `STM32CubeProgrammer/bin/STM32_Programmer_CLI${exeSuffix}`, `STLink-gdb-server/bin/ST-LINK_gdbserver${exeSuffix}`,
  `CMake/bin/cmake${exeSuffix}`, `Ninja/bin/ninja${exeSuffix}`
].map(f => root + sep + f.split('/').join(sep));
function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return { data, get: <T>(key: string, fallback: T) => (key in data ? data[key] as T : fallback), update: async (key, value) => { data[key] = value; } };
}

test('Linux: nothing installed reports every tool as missing and executes nothing', async () => {
  const host = fakeHost({ platform: 'linux' });
  const result = await discoverEmbeddedTools(host);
  for (const status of Object.values(result)) { assert.equal(status.selected, undefined); }
  assert.deepEqual(host.executed, []);
});

test('Linux: CubeCLT under a non-default root is found by layout and feeds the other tools', async () => {
  const host = fakeHost({ platform: 'linux', files: cltFiles('/opt/st/stm32cubeclt_1.18.0'), versions: { '/opt/st/stm32cubeclt_1.18.0/GNU-tools-for-STM32/bin/arm-none-eabi-gcc': 'arm-none-eabi-gcc (GNU Arm Embedded Toolchain 13.3.1) 13.3.1' } });
  const result = await discoverEmbeddedTools(host);
  assert.equal(result.stm32cubeclt.selected?.path, '/opt/st/stm32cubeclt_1.18.0');
  assert.equal(result.stm32cubeclt.selected?.source, 'hint');
  assert.equal(result['arm-gcc'].selected?.source, 'cubeclt');
  assert.match(result['arm-gcc'].selected?.version ?? '', /13\.3\.1/);
  assert.equal(result.stm32programmer.selected?.path, '/opt/st/stm32cubeclt_1.18.0/STM32CubeProgrammer/bin/STM32_Programmer_CLI');
  assert.equal(result['stlink-gdbserver'].selected?.source, 'cubeclt');
  assert.equal(result['arm-gdb'].selected?.path, '/opt/st/stm32cubeclt_1.18.0/GNU-tools-for-STM32/bin/arm-none-eabi-gdb');
});

test('ST tools and the CubeMX GUI are never executed for a version query', async () => {
  const host = fakeHost({ platform: 'linux', files: [...cltFiles('/opt/st/stm32cubeclt_1.18.0'), '/home/me/STM32CubeMX/STM32CubeMX'] });
  const result = await discoverEmbeddedTools(host);
  assert.equal(result.stm32cubemx.selected?.path, '/home/me/STM32CubeMX/STM32CubeMX');
  assert.ok(host.executed.every(c => !/^(STM32|ST-LINK)/i.test(c.split('/').pop()!)), host.executed.join());
  assert.ok(host.executed.length > 0);
});

test('PATH wins over bundled and hint locations; manual wins over PATH', async () => {
  const files = [...cltFiles('/opt/st/stm32cubeclt_1.18.0'), '/usr/bin/arm-none-eabi-gcc', '/custom/arm-none-eabi-gcc'];
  const host = fakeHost({ platform: 'linux', files, env: { PATH: '/usr/bin:/bin' } });
  assert.equal((await discoverEmbeddedTools(host))['arm-gcc'].selected?.path, '/usr/bin/arm-none-eabi-gcc');
  const manual = await discoverEmbeddedTools(host, { 'arm-gcc': '/custom/arm-none-eabi-gcc' });
  assert.equal(manual['arm-gcc'].selected?.source, 'manual');
  assert.deepEqual(manual['arm-gcc'].candidates.map(c => c.source), ['manual', 'path', 'cubeclt']);
});

test('a stale manual path is reported and discovery falls through to other sources', async () => {
  const host = fakeHost({ platform: 'linux', files: ['/usr/bin/cmake'], env: { PATH: '/usr/bin' } });
  const result = await discoverEmbeddedTools(host, { cmake: '/gone/cmake' });
  assert.equal(result.cmake.staleManual, '/gone/cmake');
  assert.equal(result.cmake.selected?.path, '/usr/bin/cmake');
});

test('Windows: .exe names, semicolon PATH, nested CubeCLT folder and Program Files hints', async () => {
  const clt = 'C:\\ST\\STM32CubeCLT\\STM32CubeCLT_1.18.0';
  const host = fakeHost({
    platform: 'win32', env: { Path: 'C:\\Tools\\ninja;C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    files: [...cltFiles(clt, '.exe', '\\'), 'C:\\Tools\\ninja\\ninja.exe', 'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX\\STM32CubeMX.exe',
      'C:\\Program Files (x86)\\Arm GNU Toolchain arm-none-eabi\\13.3\\bin\\arm-none-eabi-gcc.exe']
  });
  const result = await discoverEmbeddedTools(host);
  assert.equal(result.stm32cubeclt.selected?.path, clt);
  assert.equal(result.ninja.selected?.path, 'C:\\Tools\\ninja\\ninja.exe');
  assert.equal(result.ninja.candidates[1]?.source, 'cubeclt');
  assert.equal(result.stm32cubemx.selected?.path, 'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeMX\\STM32CubeMX.exe');
  assert.ok(result['arm-gcc'].candidates.some(c => c.source === 'hint' && c.path.includes('Arm GNU Toolchain')));
});

test('macOS: CubeMX is found inside its .app bundle, and a picked .app is normalized to the inner executable', async () => {
  const inner = '/Applications/STM32CubeMX.app/Contents/MacOS/STM32CubeMX';
  const host = fakeHost({ platform: 'darwin', files: [inner, '/Applications/ArmGNUToolchain/13.3.rel1/arm-none-eabi/bin/arm-none-eabi-gcc'] });
  const result = await discoverEmbeddedTools(host);
  assert.equal(result.stm32cubemx.selected?.path, inner);
  assert.equal(result['arm-gcc'].selected?.path, '/Applications/ArmGNUToolchain/13.3.rel1/arm-none-eabi/bin/arm-none-eabi-gcc');
  const moved = fakeHost({ platform: 'darwin', files: ['/Volumes/Tools/STM32CubeMX.app/Contents/MacOS/STM32CubeMX'] });
  assert.equal(await normalizeManualPath('stm32cubemx', '/Volumes/Tools/STM32CubeMX.app', moved), '/Volumes/Tools/STM32CubeMX.app/Contents/MacOS/STM32CubeMX');
});

test('manual locate accepts a file, a folder or a bin folder, and rejects unrelated locations', async () => {
  const host = fakeHost({ platform: 'linux', files: ['/x/gcc/bin/arm-none-eabi-gcc', '/y/STM32CubeMX'] });
  assert.equal(await normalizeManualPath('arm-gcc', '/x/gcc', host), '/x/gcc/bin/arm-none-eabi-gcc');
  assert.equal(await normalizeManualPath('arm-gcc', '/x/gcc/bin', host), '/x/gcc/bin/arm-none-eabi-gcc');
  assert.equal(await normalizeManualPath('stm32cubemx', '/y', host), '/y/STM32CubeMX');
  assert.equal(await normalizeManualPath('stm32cubemx', '/x', host), undefined);
  assert.equal(await normalizeManualPath('arm-gcc', '/missing', host), undefined);
  assert.equal(await normalizeManualPath('stm32cubeclt', '/x/gcc', host), undefined);
});

test('registry persists only manual paths and rejects invalid locations without saving', async () => {
  const store = memoryStore();
  const host = fakeHost({ platform: 'linux', files: ['/x/arm-none-eabi-gcc', '/opt/st/stm32cubeclt_1/GNU-tools-for-STM32/bin/arm-none-eabi-gcc'] });
  const registry = new EmbeddedToolRegistry(store, host);
  await assert.rejects(registry.locate('cmake', '/x'), /Nothing was saved/);
  assert.equal(store.data[embeddedToolsKey], undefined);
  assert.equal(await registry.locate('arm-gcc', '/x/arm-none-eabi-gcc'), '/x/arm-none-eabi-gcc');
  assert.deepEqual(registry.manual(), { 'arm-gcc': '/x/arm-none-eabi-gcc' });
  assert.equal(await registry.resolve('arm-gcc'), '/x/arm-none-eabi-gcc');
  await registry.forget('arm-gcc');
  assert.deepEqual(registry.manual(), {});
  assert.equal(await registry.resolve('arm-gcc'), '/opt/st/stm32cubeclt_1/GNU-tools-for-STM32/bin/arm-none-eabi-gcc');
});

test('registry ignores corrupt stored data', () => {
  const registry = new EmbeddedToolRegistry(memoryStore({ [embeddedToolsKey]: { cmake: 5, ninja: 'a\nb', 'arm-gcc': '/ok', unknown: '/x' } }), fakeHost({ platform: 'linux' }));
  assert.deepEqual(registry.manual(), { 'arm-gcc': '/ok' });
});

test('cltComponents lists only what is installed', async () => {
  const host = fakeHost({ platform: 'linux', files: ['/clt/CMake/bin/cmake'] });
  assert.deepEqual(await cltComponents('/clt', host), { cmake: '/clt/CMake/bin/cmake' });
});
