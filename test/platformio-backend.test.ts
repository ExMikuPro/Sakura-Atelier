import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { fsHost } from './support/fsHost';
import { parsePlatformioIni, environmentNames, defaultEnvironments, environmentOption } from '../src/embedded/platformio/ini';
import { platformFamily, platformioBackend, readPlatformioProject } from '../src/embedded/platformio/project';
import { buildPlatformioPlan, chooseEnvironment, platformioOperations, platformioTemplates, PlatformioPlanInput } from '../src/embedded/platformio/plans';
import { configFromJson, parseJsonOutput, readConfig, readMetadata, listPorts } from '../src/embedded/platformio/cli';
import { AdapterRegistry } from '../src/adapterRegistry';

const fixtures = path.resolve(__dirname, '../../test/fixtures/embedded');
const stm32 = path.join(fixtures, 'pio-stm32');
const other = path.join(fixtures, 'pio-other');

test('ini parser handles sections, continuation lines, comments and BOM', () => {
  const ini = parsePlatformioIni('﻿; c\n[env:a]\nbuild_flags =\n  -DX\n  -DY\n# note\nboard=uno\n\n[env:b]\nboard : mega\n');
  assert.deepEqual(environmentNames(ini), ['a', 'b']);
  assert.equal(ini.sections.get('env:a')?.options.get('build_flags'), '-DX\n-DY');
  assert.equal(ini.sections.get('env:a')?.options.get('board'), 'uno');
  assert.equal(ini.sections.get('env:b')?.options.get('board'), 'mega');
});

test('environment options follow [env] and extends, and survive cycles', () => {
  const ini = parsePlatformioIni('[env]\nframework=arduino\n[base]\nplatform=ststm32\nextends=env:x\n[env:x]\nextends=base\n[env:y]\nextends=base\nboard=b\n');
  assert.equal(environmentOption(ini, 'y', 'platform'), 'ststm32');
  assert.equal(environmentOption(ini, 'y', 'framework'), 'arduino');
  assert.equal(environmentOption(ini, 'x', 'board'), undefined);
});

test('default_envs only lists defined environments', () => {
  const ini = parsePlatformioIni('[platformio]\ndefault_envs = a, ghost\n[env:a]\n[env:b]\n');
  assert.deepEqual(defaultEnvironments(ini), ['a']);
});

test('platform family detection', () => {
  for (const value of ['ststm32', 'ststm32@^17.0.0', 'https://github.com/platformio/platform-ststm32.git', 'platform-ststm32@17']) { assert.equal(platformFamily(value), 'stm32', value); }
  assert.equal(platformFamily('native'), 'native');
  for (const value of ['atmelavr', 'espressif32', '', 'ststm32-fork-of-something-else']) { assert.equal(platformFamily(value), 'other', value); }
});

test('fixture: PlatformIO STM32 project is detected with both environments and the extends chain resolved', async () => {
  const project = await readPlatformioProject(stm32, fsHost);
  assert.ok(project);
  assert.deepEqual(project.environments.map(e => [e.name, e.family, e.board, e.framework]), [['nucleo_f401re', 'stm32', 'nucleo_f401re', 'stm32cube'], ['nucleo_l476rg', 'stm32', 'nucleo_l476rg', 'stm32cube']]);
  assert.deepEqual(project.defaultEnvironments, ['nucleo_f401re']);
});

test('fixture: PlatformIO non-STM32 project is detected as PlatformIO but not as STM32', async () => {
  const project = await readPlatformioProject(other, fsHost);
  assert.deepEqual(project?.environments.map(e => [e.name, e.family]), [['uno', 'other'], ['native', 'native']]);
  const detected = await platformioBackend.detect(other, fsHost);
  assert.equal(detected?.details.families, 'other,native');
});

test('fixture: plain C/C++ project is not a PlatformIO project', async () => {
  assert.equal(await platformioBackend.detect(path.join(fixtures, 'plain-c'), fsHost), undefined);
});

test('backend plugs into the adapter registry', async () => {
  const registry = new AdapterRegistry();
  registry.backends.register(platformioBackend.id, platformioBackend);
  assert.deepEqual((await registry.detectBackendProjects(stm32, fsHost)).map(p => p.backend), ['platformio']);
  assert.deepEqual(await registry.detectBackendProjects(path.join(fixtures, 'plain-c'), fsHost), []);
});

async function input(root: string, env: string, operation: PlatformioPlanInput['operation'], extra: Partial<PlatformioPlanInput> = {}): Promise<PlatformioPlanInput> {
  return { operation, env, project: (await readPlatformioProject(root, fsHost))!, pio: '/opt/pio/bin/pio', ...extra };
}

test('build, clean and monitor are safe and scoped to the chosen environment', async () => {
  const build = buildPlatformioPlan(await input(stm32, 'nucleo_l476rg', 'build'));
  assert.deepEqual(build.steps[0].args, ['run', '-d', stm32, '-e', 'nucleo_l476rg']);
  assert.equal(build.risk, 'safe'); assert.deepEqual(build.blockers, []);
  assert.deepEqual(buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'clean')).steps[0].args.slice(-2), ['-t', 'clean']);
  const monitor = buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'monitor', { port: '/dev/ttyACM0', baud: 115200 }));
  assert.deepEqual(monitor.steps[0].args, ['device', 'monitor', '-d', stm32, '-e', 'nucleo_f401re', '--port', '/dev/ttyACM0', '--baud', '115200']);
  assert.equal(monitor.risk, 'safe');
});

test('upload is an explicit device write that needs confirmation and never maps from build', async () => {
  const upload = buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'upload', { port: '/dev/ttyACM0' }));
  assert.equal(upload.risk, 'writes-device');
  assert.match(upload.confirm ?? '', /write firmware to the board on \/dev\/ttyACM0/);
  assert.deepEqual(upload.steps[0].args, ['run', '-d', stm32, '-e', 'nucleo_f401re', '-t', 'upload', '--upload-port', '/dev/ttyACM0']);
  assert.match(buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'upload', { remote: true })).confirm ?? '', /remote machine/);
  assert.equal(buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'build')).risk, 'safe');
});

test('no operation can request an erase or another target through extra arguments', async () => {
  for (const operation of platformioOperations) {
    for (const extra of [['-t', 'erase'], ['--target', 'erase'], ['--target=erase'], ['-terase']]) {
      const plan = buildPlatformioPlan(await input(stm32, 'nucleo_f401re', operation, { extraArgs: extra, ideExtensionInstalled: true }));
      assert.ok(plan.blockers.some(b => /selects a PlatformIO target/.test(b)), `${operation} ${extra.join(' ')}`);
    }
  }
  for (const operation of platformioOperations) {
    const plan = buildPlatformioPlan(await input(stm32, 'nucleo_f401re', operation, { ideExtensionInstalled: true }));
    assert.ok(plan.steps.every(s => !s.args.includes('erase')), operation);
  }
});

test('test is build-only on hardware environments and runs normally on native; device tests are a separate confirmed action', async () => {
  const hardware = buildPlatformioPlan(await input(other, 'uno', 'test'));
  assert.ok(hardware.steps[0].args.includes('--without-uploading') && hardware.steps[0].args.includes('--without-testing'));
  assert.equal(hardware.risk, 'safe');
  const native = buildPlatformioPlan(await input(other, 'native', 'test'));
  assert.deepEqual(native.steps[0].args, ['test', '-d', other, '-e', 'native']);
  const device = buildPlatformioPlan(await input(other, 'uno', 'testOnDevice'));
  assert.equal(device.risk, 'writes-device'); assert.ok(!device.steps[0].args.includes('--without-uploading'));
  assert.ok(buildPlatformioPlan(await input(other, 'native', 'testOnDevice')).blockers.length > 0);
});

test('debug reuses the PlatformIO IDE debug type and is blocked until its prerequisites exist', async () => {
  const blocked = buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'debug'));
  assert.equal(blocked.blockers.length, 2); assert.deepEqual(blocked.steps, []);
  const ready = buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'debug', { ideExtensionInstalled: true, metadata: { progPath: '/p/.pio/build/nucleo_f401re/firmware.elf', gdbPath: '/tc/bin/arm-none-eabi-gdb', compilerPath: '/tc/bin/arm-none-eabi-gcc' } }));
  assert.deepEqual(ready.blockers, []);
  assert.equal(ready.debug?.configuration.type, 'platformio-debug');
  assert.equal(ready.debug?.configuration.projectEnvName, 'nucleo_f401re');
  assert.equal(ready.debug?.configuration.toolchainBinDir, '/tc/bin');
  assert.equal(ready.risk, 'writes-device');
});

test('unknown environment and missing pio block the plan instead of guessing', async () => {
  assert.match(buildPlatformioPlan(await input(stm32, 'nope', 'build')).blockers[0], /not defined/);
  assert.match(buildPlatformioPlan(await input(stm32, 'nucleo_f401re', 'build', { pio: undefined })).blockers[0], /Embedded Tools/);
});

test('environment choice: remembered, single, default_envs, otherwise ask', async () => {
  const two = (await readPlatformioProject(stm32, fsHost))!;
  assert.deepEqual(chooseEnvironment(two, 'nucleo_l476rg'), { kind: 'selected', env: 'nucleo_l476rg' });
  assert.deepEqual(chooseEnvironment(two), { kind: 'selected', env: 'nucleo_f401re' });
  const noDefault = { ...two, defaultEnvironments: [] };
  assert.deepEqual(chooseEnvironment(noDefault, 'gone'), { kind: 'choose', choices: ['nucleo_f401re', 'nucleo_l476rg'] });
  assert.deepEqual(chooseEnvironment({ ...two, environments: [two.environments[0]] }), { kind: 'selected', env: 'nucleo_f401re' });
  assert.deepEqual(chooseEnvironment({ ...two, environments: [] }), { kind: 'none' });
});

test('templates are generated per [env:NAME] and mark device-writing operations', async () => {
  const templates = platformioTemplates((await readPlatformioProject(other, fsHost))!);
  assert.equal(templates.filter(t => t.env === 'uno').length, 7);
  assert.equal(templates.filter(t => t.env === 'native').length, 6);
  assert.deepEqual(templates.filter(t => t.risk === 'writes-device').map(t => t.operation).sort(), ['debug', 'debug', 'testOnDevice', 'upload', 'upload']);
  assert.equal(new Set(templates.map(t => t.id)).size, templates.length);
});

test('CLI output parsing tolerates the trailing banner, list values and missing data (shapes taken from pio 6.2.0)', async () => {
  const banner = '\n********\nIf you like PlatformIO, please:\n';
  const config = '[["platformio", [["default_envs", ["a"]]]], ["env:a", [["platform", "ststm32"], ["build_flags", ["-DX", "-DY"]]]]]';
  const ini = configFromJson(parseJsonOutput(config + banner));
  assert.equal(ini.sections.get('env:a')?.options.get('build_flags'), '-DX\n-DY');
  const calls: string[][] = [];
  const run = async (_c: string, args: string[]) => { calls.push(args); return args[1] === 'config' ? config : args[1] === 'metadata' ? JSON.stringify({ a: { prog_path: '/p/firmware.elf', gdb_path: '/tc/arm-none-eabi-gdb', cc_path: '/tc/gcc', svd_path: null } }) : '[{"port":"/dev/ttyACM0","description":"ST-Link","hwid":"x"}]'; };
  assert.equal((await readConfig(run, 'pio', '/p')).sections.size, 2);
  assert.deepEqual(await readMetadata(run, 'pio', '/p', 'a'), { progPath: '/p/firmware.elf', gdbPath: '/tc/arm-none-eabi-gdb', compilerPath: '/tc/gcc' });
  assert.equal(await readMetadata(run, 'pio', '/p', 'missing'), undefined);
  assert.deepEqual(await listPorts(run, 'pio', '/p'), [{ port: '/dev/ttyACM0', description: 'ST-Link' }]);
  assert.deepEqual(calls[0], ['project', 'config', '-d', '/p', '--json-output']);
  assert.throws(() => configFromJson({}), /Unexpected/);
});

// Optional: set SAKURA_TEST_PIO to a real `pio` to compare the offline parser with the official CLI. Reads config only; installs nothing.
test('official CLI and offline parser agree on the fixtures', { skip: !process.env.SAKURA_TEST_PIO }, async () => {
  const { nodeRunner } = await import('../src/embedded/process');
  const { describeEnvironments } = await import('../src/embedded/platformio/project');
  for (const root of [stm32, other]) {
    const official = describeEnvironments(await readConfig(nodeRunner, process.env.SAKURA_TEST_PIO!, root));
    const offline = (await readPlatformioProject(root, fsHost))!.environments;
    assert.deepEqual(official.map(e => [e.name, e.family, e.board]), offline.map(e => [e.name, e.family, e.board]));
  }
});
