import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { fsHost } from './support/fsHost';
import { parseIoc, isStm32Part } from '../src/embedded/stm32/ioc';
import { readStm32Project, stm32Backend, presetNames } from '../src/embedded/stm32/project';
import { buildStm32Plan, expectedElf, forbiddenFlashArgument, stm32Operations, ToolPaths, Stm32PlanInput } from '../src/embedded/stm32/plans';
import { platformioBackend } from '../src/embedded/platformio/project';
import { AdapterRegistry } from '../src/adapterRegistry';

const fixtures = path.resolve(__dirname, '../../test/fixtures/embedded');
const dir = (name: string) => path.join(fixtures, name);
const tools: ToolPaths = { openocd:'/t/openocd', cmake: '/t/cmake/bin/cmake', ninja: '/t/ninja/ninja', 'arm-gcc': '/t/arm/bin/arm-none-eabi-gcc', 'arm-gdb': '/t/arm/bin/arm-none-eabi-gdb', stm32programmer: '/t/prog/bin/STM32_Programmer_CLI', 'stlink-gdbserver': '/t/gdb/bin/ST-LINK_gdbserver' };
const flash = { firmware: '/p/build/Debug/app.elf', probe: { interface: 'SWD' as const }, device: 'STM32G0B1RETx' };

async function plan(root: string, extra: Partial<Stm32PlanInput> & Pick<Stm32PlanInput, 'operation'>) {
  return buildStm32Plan({ project: (await readStm32Project(dir(root), fsHost))!, tools, platform: 'linux', ...extra });
}

test('ioc parser reads the MCU, part number, project and toolchain, and treats the board name as separate', async () => {
  const info = parseIoc((await import('node:fs')).readFileSync(path.join(dir('stm32-cubemx'), 'stm32-cubemx.ioc'), 'utf8'));
  assert.deepEqual(info, { mcu: 'STM32G0B1RETx', partNumber: 'STM32G0B1RET6', family: 'STM32G0', package: 'LQFP64', board: 'custom', projectName: 'stm32-cubemx', toolchain: 'STM32CubeIDE' });
  assert.equal(parseIoc('Mcu.UserName=NUCLEO-G071RB\n').mcu, '');
  assert.equal(parseIoc('').mcu, '');
  assert.equal(parseIoc('Mcu.Name=STM32G0B1R(B-C-E)Tx\n').mcu, 'STM32G0B1R(B-C-E)Tx');
  assert.ok(isStm32Part('STM32G071RBTx') && !isStm32Part('NUCLEO-G071RB') && !isStm32Part('ESP32'));
});

test('preset names skip hidden presets and survive bad JSON', () => {
  assert.deepEqual(presetNames('{"configurePresets":[{"name":"a","hidden":true},{"name":"b"}]}'), ['b']);
  assert.deepEqual(presetNames('{oops'), []);
  assert.deepEqual(presetNames(undefined), []);
});

test('five fixture types are classified by exactly the right backend', async () => {
  const registry = new AdapterRegistry();
  registry.backends.register('platformio', platformioBackend); registry.backends.register('stm32', stm32Backend);
  const ids = async (name: string) => (await registry.detectBackendProjects(dir(name), fsHost)).map(p => p.backend);
  assert.deepEqual(await ids('plain-c'), []);
  assert.deepEqual(await ids('stm32-cmake'), ['stm32']);
  assert.deepEqual(await ids('stm32-cubemx'), ['stm32']);
  assert.deepEqual(await ids('pio-stm32'), ['platformio']);
  assert.deepEqual(await ids('pio-other'), ['platformio']);
});

test('fixture: STM32 CMake project exposes presets, toolchain file and project name', async () => {
  const project = (await readStm32Project(dir('stm32-cmake'), fsHost))!;
  assert.equal(project.buildSystem, 'cmake'); assert.equal(project.projectName, 'blink_g0');
  assert.deepEqual(project.presets, ['Debug', 'Release']);
  assert.equal(project.toolchainFile, path.join(dir('stm32-cmake'), 'cmake', 'gcc-arm-none-eabi.cmake'));
  assert.equal(project.ioc, undefined);
});

test('fixture: CubeMX .ioc project is detected without a build system and without running CubeMX', async () => {
  const detected = await stm32Backend.detect(dir('stm32-cubemx'), fsHost);
  assert.equal(detected?.buildSystem, 'cubemx');
  assert.equal(detected?.details.mcu, 'STM32G0B1RETx'); assert.equal(detected?.details.cubemx, 'true');
});

test('a plain CMake project is not mistaken for STM32', async () => { assert.equal(await stm32Backend.detect(dir('plain-c'), fsHost), undefined); });

test('Build uses presets when defined and never touches the device', async () => {
  const p = await plan('stm32-cmake', { operation: 'build', preset: 'Release' });
  assert.deepEqual(p.steps.map(s => s.args), [['--preset', 'Release', '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON'], ['--build', path.join(dir('stm32-cmake'), 'build/Release')]]);
  assert.equal(p.risk, 'safe'); assert.deepEqual(p.blockers, []);
  assert.ok(p.steps[0].env && p.steps[0].env.PATH.startsWith('/t/arm/bin:'), 'only the step environment is extended');
  assert.deepEqual((await plan('stm32-cmake', { operation: 'build', preset: 'Nope' })).blockers, ['CMake preset "Nope" is not defined.']);
});

test('Build without presets configures an out-of-source directory with the project toolchain file', async () => {
  const p = await plan('stm32-cmake', { operation: 'build', profile: 'Release' });
  const root = dir('stm32-cmake');
  assert.deepEqual(p.steps[0].args, ['-S', root, '-B', path.join(root, 'build', 'Release'), '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON', '-DCMAKE_BUILD_TYPE=Release', '-G', 'Ninja', `-DCMAKE_TOOLCHAIN_FILE=${path.join(root, 'cmake', 'gcc-arm-none-eabi.cmake')}`]);
  assert.deepEqual(p.steps[1].args, ['--build', path.join(root, 'build', 'Release')]);
});

test('Build reports missing tools and CubeMX-only projects instead of guessing', async () => {
  assert.equal((await plan('stm32-cmake', { operation: 'build', tools: {} })).blockers.length, 2);
  assert.match((await plan('stm32-cubemx', { operation: 'build' })).blockers[0], /生成 CMake/);
});

test('Flash needs firmware, probe and device; without them nothing is planned', async () => {
  const p = await plan('stm32-cmake', { operation: 'flash' });
  assert.ok(p.blockers.some(b => /firmware/.test(b))); assert.deepEqual(p.steps, []); assert.equal(p.risk, 'writes-device');
});

test('Flash plan programs and verifies only, names the target in the confirmation, and never erases', async () => {
  const p = await plan('stm32-cmake', { operation: 'flash', flash: { ...flash, probe: { interface: 'SWD', serial: '066DFF485750' } } });
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.steps[0].args, ['-f','interface/stlink.cfg','-c','transport select hla_swd','-f','target/stm32g0x.cfg','-c','adapter speed 4000','-c','adapter serial \"066DFF485750\"','-c','program \"/p/build/Debug/app.elf\" verify reset exit']);
  assert.equal(p.steps[0].command, '/t/openocd');
  assert.match(p.confirm ?? '', /app\.elf to STM32G0B1RETx through ST-LINK.*No full-chip erase/);
  for (const bad of [['-e', 'all'], ['--erase'], ['-ob', 'RDP=0'], ['-rdu'], ['erase']]) {
    assert.ok((await plan('stm32-cmake', { operation: 'flash', flash, extraArgs: bad })).blockers.some(b => /not allowed/.test(b)), bad.join(' '));
  }
  assert.equal(forbiddenFlashArgument(['-v']), undefined);
});

test('Flash validates image type, .bin address and probe serial', async () => {
  assert.ok((await plan('stm32-cmake', { operation: 'flash', flash: { ...flash, firmware: '/p/a.txt' } })).blockers.some(b => /firmware image/.test(b)));
  assert.ok((await plan('stm32-cmake', { operation: 'flash', flash: { ...flash, firmware: '/p/a.bin' } })).blockers.some(b => /load address/.test(b)));
  const bin = await plan('stm32-cmake', { operation: 'flash', flash: { ...flash, firmware: '/p/a.bin', address: '0x08000000' } });
  assert.equal(bin.steps[0].args.at(-1), 'program \"/p/a.bin\" verify reset exit 0x08000000');
  assert.ok((await plan('stm32-cmake', { operation: 'flash', flash: { ...flash, probe: { interface: 'SWD', serial: 'a b;rm' } } })).blockers.some(b => /serial/.test(b)));
  assert.ok((await plan('stm32-cmake', { operation: 'flash', flash: { ...flash, device: ' ' } })).blockers.some(b => /Confirm the target MCU/.test(b)));
});

test('Build, Flash and Debug are separate operations and managed Run composes Build and Flash', () => {
  assert.deepEqual([...stm32Operations], ['build', 'flash', 'debug']);
  assert.ok(!(stm32Operations as readonly string[]).includes('run'));
});

test('Debug builds first, then launches Cortex-Debug with an owned OpenOCD server, and is blocked without prerequisites', async () => {
  const blocked = await plan('stm32-cubemx', { operation: 'debug', tools: {} });
  assert.ok(blocked.blockers.length >= 4);
  const p = await plan('stm32-cmake', { operation: 'debug', device: 'STM32G0B1RETx', cortexDebugInstalled: true });
  assert.deepEqual(p.blockers, []);
  assert.equal(p.steps.length, 2);
  assert.equal(p.debug?.extension, 'marus25.cortex-debug');
  assert.deepEqual(p.debug?.configuration, { type: 'cortex-debug', request: 'launch', name: 'STM32 Debug (blink_g0)', servertype: 'openocd', cwd: dir('stm32-cmake'), executable: expectedElf((await readStm32Project(dir('stm32-cmake'), fsHost))!), device: 'STM32G0B1RETx', runToEntryPoint: 'main', configFiles:['interface/stlink.cfg','target/stm32g0x.cfg'], gdbPath: '/t/arm/bin/arm-none-eabi-gdb', armToolchainPath: '/t/arm/bin', serverpath: '/t/openocd' });
  assert.equal(p.risk, 'writes-device');
  assert.ok((await plan('stm32-cmake', { operation: 'debug', cortexDebugInstalled: true })).blockers.some(b => /target MCU/.test(b)));
});

test('no plan for any operation contains an erase argument', async () => {
  for (const operation of stm32Operations) {
    const p = await plan('stm32-cmake', { operation, flash, device: 'STM32G0B1RETx', cortexDebugInstalled: true });
    for (const s of p.steps) { assert.ok(!s.args.some(a => /erase|^-e$|^-ob$/i.test(a)), `${operation}: ${s.args.join(' ')}`); }
  }
});
