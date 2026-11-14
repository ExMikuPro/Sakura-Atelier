import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CreationContext, CreationDeps, CreationRequest, executeCreation, planCreation, sanitizeOptions, validateProjectName } from '../src/embedded/projects/creation';
import { builtinProjectTemplates } from '../src/embedded/projects/template';
import { FavoriteTemplates, restoreFavoriteTemplate, templateFingerprint } from '../src/embedded/projects/favoriteTemplates';
import { parseBoards } from '../src/embedded/devices/pioBoards';
import { AdapterRegistry } from '../src/adapterRegistry';
import { favoriteTemplatesKey, SyncableStore, syncedKeys } from '../src/embedded/devices/store';

const boards = new Map(parseBoards(readFileSync(path.resolve(__dirname, '../../test/fixtures/embedded/pio-boards.json'), 'utf8')).map(b => [b.id, b]));
const template = (id: string) => builtinProjectTemplates.find(t => t.id === id);
const existing = new Set<string>(['/work', '/work/taken']); const dirs = new Set<string>(['/work', '/work/stm']);
const context = (over: Partial<CreationContext> = {}): CreationContext => ({ template: template('platformio.board'), tools: { pio: '/pio/bin/pio', cubemx: '/opt/CubeMX/STM32CubeMX' }, boards, fs: { exists: async f => existing.has(f), isDirectory: async f => dirs.has(f) }, isStm32Project: async f => f === '/work/stm', ...over });
const request = (over: Partial<CreationRequest> = {}): CreationRequest => ({ templateId: 'platformio.board', device: { kind: 'pio-board', id: 'nucleo_g071rb' }, framework: 'stm32cube', name: 'blink', parentDir: '/work', ...over });
const codes = (plan: { blockers: { code: string }[] }) => plan.blockers.map(b => b.code);
function store(): SyncableStore & { data: Record<string, unknown> } { const data: Record<string, unknown> = {}; return { data, get: <T>(k: string, f: T) => (k in data ? data[k] as T : f), update: async (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } }; }

test('project names are single safe path segments', () => {
  for (const ok of ['blink', 'My-App_2', 'a.b', 'x'.repeat(64)]) { assert.equal(validateProjectName(ok), undefined, ok); }
  for (const bad of ['', '.hidden', '-x', 'a/b', 'a\\b', '..', 'a b', 'name.', 'CON', 'nul.txt', 'com1', 'x'.repeat(65), '空']) { assert.ok(validateProjectName(bad), bad); }
});

test('PlatformIO plan: create the directory, then the official CLI initializes it with the board id from PlatformIO', async () => {
  const plan = await planCreation(request({ options: { monitorSpeed: '115200', sampleCode: true } }), context());
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.steps.map(s => s.kind), ['mkdir', 'run', 'open']);
  const run = plan.steps[1] as { command: string; args: string[]; cwd: string };
  assert.equal(run.command, '/pio/bin/pio');
  assert.deepEqual(run.args, ['project', 'init', '-d', '/work/blink', '--board', 'nucleo_g071rb', '--project-option', 'framework=stm32cube', '--project-option', 'monitor_speed=115200', '--sample-code', '--no-install-dependencies']);
  assert.ok(!run.args.includes('--ide'), 'no VS Code settings are written');
  assert.equal(plan.target, '/work/blink');
});

test('an existing folder is never reused or overwritten', async () => {
  const plan = await planCreation(request({ name: 'taken' }), context());
  assert.deepEqual(codes(plan), ['exists']); assert.deepEqual(plan.steps, []);
});

test('invalid input is reported, and an unlisted board or unsupported framework blocks the plan', async () => {
  assert.deepEqual(codes(await planCreation(request({ name: '../evil' }), context())), ['name']);
  assert.deepEqual(codes(await planCreation(request({ parentDir: 'relative' }), context())), ['parent']);
  assert.deepEqual(codes(await planCreation(request({ parentDir: '/missing' }), context())), ['parent']);
  assert.deepEqual(codes(await planCreation(request({ device: undefined }), context())), ['device-required']);
  assert.deepEqual(codes(await planCreation(request({ device: { kind: 'pio-board', id: 'no_such_board' } }), context())), ['board-unknown']);
  assert.deepEqual(codes(await planCreation(request({ framework: 'mbed-nope' }), context())), ['framework']);
  assert.deepEqual(codes(await planCreation(request({ framework: undefined }), context())), ['framework']);
  assert.deepEqual(codes(await planCreation(request(), context({ tools: {} }))), ['no-pio']);
  assert.deepEqual(codes(await planCreation(request({ options: { token: 'x' } as never }), context())), ['option']);
  assert.deepEqual(codes(await planCreation(request(), context({ template: undefined }))), ['template']);
});

test('an STM32 MCU or ST board is never accepted as a PlatformIO board', async () => {
  for (const device of [{ kind: 'stm32-mcu' as const, id: 'STM32G0B1RETx' }, { kind: 'stm32-board' as const, id: 'NUCLEO-G071RB' }]) {
    const plan = await planCreation(request({ device }), context());
    assert.deepEqual(codes(plan), ['device-kind']); assert.deepEqual(plan.steps, []);
  }
});

test('options carry only plain values: no paths, no unknown keys', () => {
  assert.deepEqual(sanitizeOptions({ monitorSpeed: '9600', sampleCode: false, generator: 'cmake' }), { options: { monitorSpeed: '9600', sampleCode: false, generator: 'cmake' }, invalid: [] });
  assert.deepEqual(sanitizeOptions({ monitorSpeed: '../x', generator: '/bin/sh', extra: 1 }).invalid, ['monitorSpeed', 'generator', 'extra']);
});

test('execution creates the directory and runs the CLI once; a failing step stops and deletes nothing', async () => {
  const calls: string[] = []; const deps: CreationDeps = { mkdir: async p => { calls.push(`mkdir ${p}`); }, run: async (c, a) => { calls.push(`run ${c} ${a[0]}`); }, confirm: async () => true, launch: () => calls.push('launch') };
  const plan = await planCreation(request(), context());
  assert.deepEqual(await executeCreation(plan, deps), { target: '/work/blink', open: '/work/blink', launched: false });
  assert.deepEqual(calls, ['mkdir /work/blink', 'run /pio/bin/pio project']);
  const failing: CreationDeps = { ...deps, run: async () => { throw new Error('pio failed'); } };
  await assert.rejects(executeCreation(plan, failing), /pio failed/);
  await assert.rejects(executeCreation({ ...plan, blockers: [{ code: 'name', message: 'x' }] }, deps), /x/);
});

test('a folder created after planning is not reused: mkdir fails and the CLI never runs', async () => {
  let ran = false;
  const deps: CreationDeps = { mkdir: async () => { throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); }, run: async () => { ran = true; }, confirm: async () => true, launch: () => undefined };
  await assert.rejects(executeCreation(await planCreation(request(), context()), deps), /EEXIST/);
  assert.equal(ran, false);
});

test('STM32CubeMX plan creates only the folder, asks before starting CubeMX, and never generates code itself', async () => {
  const req = request({ templateId: 'stm32.cubemx', device: { kind: 'stm32-mcu', id: 'STM32G0B1RETx' }, framework: undefined, options: { generator: 'cmake' } });
  const plan = await planCreation(req, context({ template: template('stm32.cubemx') }));
  assert.deepEqual(plan.blockers, []); assert.deepEqual(plan.steps.map(s => s.kind), ['mkdir', 'launch-cubemx', 'open']);
  const launch = plan.steps[1] as { args: string[]; confirm: string };
  assert.deepEqual(launch.args, []); assert.match(launch.confirm, /Start STM32CubeMX now.*CMake.*\/work\/blink/);
  const calls: string[] = [];
  const deps = (answer: boolean): CreationDeps => ({ mkdir: async () => { calls.push('mkdir'); }, run: async () => { calls.push('run'); }, confirm: async () => answer, launch: c => calls.push(`launch ${c}`) });
  assert.equal((await executeCreation(plan, deps(false))).launched, false); assert.deepEqual(calls, ['mkdir']);
  calls.length = 0;
  assert.equal((await executeCreation(plan, deps(true))).launched, true); assert.deepEqual(calls, ['mkdir', 'launch /opt/CubeMX/STM32CubeMX']);
});

test('STM32CubeMX plan without CubeMX or in a remote window still creates the folder, warns, and never launches', async () => {
  const req = request({ templateId: 'stm32.cubemx', device: { kind: 'stm32-board', id: 'NUCLEO-G071RB' }, framework: undefined });
  const missing = await planCreation(req, context({ template: template('stm32.cubemx'), tools: {} }));
  assert.ok(!missing.steps.some(s => s.kind === 'launch-cubemx')); assert.match(missing.warnings[0].message, /not found/); assert.equal(missing.warnings[0].code, 'no-cubemx');
  const remote = await planCreation(req, context({ template: template('stm32.cubemx'), remote: true }));
  assert.ok(!remote.steps.some(s => s.kind === 'launch-cubemx')); assert.match(remote.warnings[0].message, /remote/); assert.equal(remote.warnings[0].code, 'remote-cubemx');
});

test('importing an existing STM32 project only opens it, after checking it is one', async () => {
  const importing = (dir: string) => planCreation({ templateId: 'stm32.import', name: 'x', parentDir: dir }, context({ template: template('stm32.import') }));
  assert.deepEqual((await importing('/work/stm')).steps, [{ kind: 'open', path: '/work/stm' }]);
  assert.deepEqual(codes(await importing('/work')), ['not-stm32']);
  assert.deepEqual(codes(await importing('/nowhere')), ['parent']);
});

test('favorite templates: save, deduplicate, toggle, persist across workspaces, and never hold a path or a name', async () => {
  const s = store(); const favorites = new FavoriteTemplates(s, () => 7);
  const input = { templateId: 'platformio.board', device: { kind: 'pio-board' as const, id: 'nucleo_g071rb', name: 'Nucleo G071RB' }, framework: 'stm32cube', options: { monitorSpeed: '115200' } };
  assert.equal(await favorites.toggle(input), true); await favorites.add(input); await favorites.add({ ...input });
  assert.equal(new FavoriteTemplates(s).list().length, 1);
  assert.ok(new FavoriteTemplates(s).isFavorite(input));
  assert.equal(JSON.stringify(s.data).includes('/work'), false);
  assert.ok(syncedKeys.includes(favoriteTemplatesKey));
  await assert.rejects(favorites.add({ ...input, options: { monitorSpeed: '/etc/passwd' } }), /Unsupported option/);
  await assert.rejects(favorites.add({ ...input, framework: '../x' }), /Invalid framework/);
  await assert.rejects(favorites.add({ ...input, device: { kind: 'pio-board', id: '/dev/tty' } }), /Invalid device/);
  assert.equal(await favorites.toggle(input), false); assert.equal(favorites.list().length, 0);
  assert.equal(templateFingerprint({ templateId: 'a', options: { a: 1 } as never }), templateFingerprint({ templateId: 'a', options: { a: 1 } as never }));
});

test('favorite templates of different combinations stay separate', async () => {
  const favorites = new FavoriteTemplates(store());
  await favorites.add({ templateId: 'platformio.board', device: { kind: 'pio-board', id: 'nucleo_g071rb' }, framework: 'stm32cube' });
  await favorites.add({ templateId: 'platformio.board', device: { kind: 'pio-board', id: 'nucleo_g071rb' }, framework: 'arduino' });
  await favorites.add({ templateId: 'stm32.cubemx', device: { kind: 'stm32-mcu', id: 'STM32G0B1RETx' }, options: { generator: 'cmake' } });
  assert.equal(favorites.list().length, 3);
  assert.equal(favorites.list().find(f => f.templateId === 'stm32.cubemx')!.name, 'STM32G0B1RETx + stm32.cubemx');
});

test('corrupt stored templates are ignored', () => {
  const s = store(); s.data[favoriteTemplatesKey] = { version: 1, items: [null, {}, { templateId: '../x' }, { templateId: 'a', device: { kind: 'pio-board', id: '/x' } }, { templateId: 'ok', options: { evil: '/x' } }] };
  assert.deepEqual(new FavoriteTemplates(s).list().map(f => f.templateId), ['ok']);
});

test('picking a favorite restores device, framework and options, and the plan is the same as choosing them by hand', async () => {
  const favorites = new FavoriteTemplates(store());
  const saved = await favorites.add({ templateId: 'platformio.board', device: { kind: 'pio-board', id: 'nucleo_g071rb', name: 'Nucleo G071RB' }, framework: 'stm32cube', options: { monitorSpeed: '115200' } });
  const registry = new AdapterRegistry(); for (const t of builtinProjectTemplates) { registry.projectTemplates.register(t.id, t); }
  const restored = restoreFavoriteTemplate(saved, { templates: registry.projectTemplates, boards, boardsAvailable: true });
  assert.deepEqual(restored.problems, []);
  assert.deepEqual([restored.templateId, restored.device, restored.framework, restored.options], ['platformio.board', { kind: 'pio-board', id: 'nucleo_g071rb' }, 'stm32cube', { monitorSpeed: '115200' }]);
  const viaFavorite = await planCreation({ templateId: restored.templateId, device: restored.device, framework: restored.framework, options: restored.options, name: 'blink', parentDir: '/work' }, context());
  const byHand = await planCreation(request({ options: { monitorSpeed: '115200' } }), context());
  assert.deepEqual(viaFavorite, byHand);
});

test('a favorite whose board, framework, template or PlatformIO is unavailable is kept and explained with a fix', async () => {
  const favorites = new FavoriteTemplates(store());
  const registry = new AdapterRegistry(); for (const t of builtinProjectTemplates) { registry.projectTemplates.register(t.id, t); }
  const make = (device: string, framework: string, templateId = 'platformio.board') => favorites.add({ templateId, device: { kind: 'pio-board', id: device }, framework });
  const gone = restoreFavoriteTemplate(await make('retired_board', 'arduino'), { templates: registry.projectTemplates, boards, boardsAvailable: true });
  assert.deepEqual(gone.problems.map(p => p.code), ['device-unknown']); assert.match(gone.problems[0].fix, /Reload the boards/);
  const framework = restoreFavoriteTemplate(await make('uno', 'zephyr'), { templates: registry.projectTemplates, boards, boardsAvailable: true });
  assert.deepEqual(framework.problems.map(p => p.code), ['framework-unsupported']);
  const noPio = restoreFavoriteTemplate(await make('uno', 'arduino'), { templates: registry.projectTemplates, boards: new Map(), boardsAvailable: false });
  assert.deepEqual(noPio.problems.map(p => p.code), ['device-unavailable']); assert.match(noPio.problems[0].fix, /Embedded Tools/);
  const old = restoreFavoriteTemplate(await make('uno', 'arduino', 'future.template'), { templates: registry.projectTemplates, boards, boardsAvailable: true });
  assert.deepEqual(old.problems.map(p => p.code), ['template-missing']);
  assert.equal(favorites.list().length, 4, 'no favorite was removed');
});

test('the registry holds project templates apart from adapters, backends and run targets', () => {
  const registry = new AdapterRegistry(); for (const t of builtinProjectTemplates) { registry.projectTemplates.register(t.id, t); }
  assert.deepEqual(registry.projectTemplates.keys(), ['general.empty', 'general.python', 'general.node', 'general.typescript', 'general.go', 'general.rust', 'general.c', 'general.cpp', 'general.csharp', 'general.java', 'platformio.board', 'stm32.cubemx', 'stm32.import']);
  assert.equal(registry.backends.size, 0);
});

test('real PlatformIO CLI creates the project (set SAKURA_TEST_PIO to run)', { skip: !process.env.SAKURA_TEST_PIO }, async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-create-'));
  try {
    const real = context({ tools: { pio: process.env.SAKURA_TEST_PIO }, fs: { exists: async f => fs.stat(f).then(() => true, () => false), isDirectory: async f => fs.stat(f).then(s => s.isDirectory(), () => false) } });
    const plan = await planCreation(request({ parentDir: parent, options: { monitorSpeed: '115200' } }), real);
    assert.deepEqual(plan.blockers, []);
    const { execFile } = await import('node:child_process');
    await executeCreation(plan, { mkdir: p => fs.mkdir(p), run: (c, a, cwd) => new Promise((res, rej) => execFile(c, a, { cwd }, e => e ? rej(e) : res())), confirm: async () => false, launch: () => undefined });
    const ini = await fs.readFile(path.join(parent, 'blink', 'platformio.ini'), 'utf8');
    assert.match(ini, /\[env:nucleo_g071rb\]/); assert.match(ini, /board = nucleo_g071rb/); assert.match(ini, /framework = stm32cube/); assert.match(ini, /monitor_speed = 115200/);
    assert.deepEqual(codes(await planCreation(request({ parentDir: parent }), real)), ['exists']);
    assert.equal((await fs.readdir(path.join(parent, 'blink'))).includes('.vscode'), false, 'no VS Code settings written');
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
