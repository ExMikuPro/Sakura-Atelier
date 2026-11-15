import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { WizardDeps, WizardModel, parseMessage, sanitizeState } from '../src/embedded/projects/wizardModel';
import { wizardChinese, wizardLabelKeys, wizardText } from '../src/embedded/projects/wizardStrings';
import { renderWizardHtml, wizardScript } from '../src/embedded/projects/wizardHtml';
import { DeviceFavorites } from '../src/embedded/devices/favorites';
import { RecentDevices } from '../src/embedded/devices/recents';
import { FavoriteTemplates } from '../src/embedded/projects/favoriteTemplates';
import { builtinProjectTemplates } from '../src/embedded/projects/template';
import { parseBoards } from '../src/embedded/devices/pioBoards';
import { DeviceCatalog, DeviceProvider, ProviderStatus } from '../src/embedded/devices/provider';
import type { DeviceInfo, DeviceKind } from '../src/embedded/devices/model';
import type { SyncableStore } from '../src/embedded/devices/store';
import { embeddedChinese } from '../src/embedded/strings';

const boards = parseBoards(readFileSync(path.resolve(__dirname, '../../test/fixtures/embedded/pio-boards.json'), 'utf8'));
const templates = new Map(builtinProjectTemplates.map(t => [t.id, t]));
function store(): SyncableStore & { data: Record<string, unknown> } { const data: Record<string, unknown> = {}; return { data, get: <T>(k: string, f: T) => (k in data ? data[k] as T : f), update: async (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); } }; }

interface Env { s: SyncableStore & { data: Record<string, unknown> }; model: WizardModel; calls: { loads: number }; set(devices: DeviceInfo[], status: Map<DeviceKind, ProviderStatus>): void }
function env(initial?: unknown, over: Partial<WizardDeps> & { remote?: boolean; tools?: { pio?: string; cubemx?: string }; language?: 'zh-cn' | 'en' } = {}, sharedStore = store()): Env {
  const calls = { loads: 0 }; let devices: DeviceInfo[] = boards; let status = new Map<DeviceKind, ProviderStatus>([['pio-board', { state: 'ready' }]]);
  const s = sharedStore;
  const dirs = new Set(['/work', '/work/stm']); const taken = new Set(['/work/taken']);
  const model = new WizardModel({
    favorites: new DeviceFavorites(s), recents: new RecentDevices(s, (() => { let t = 1; return () => t++; })()), templates: new FavoriteTemplates(s),
    projectTemplates: { get: id => templates.get(id), values: () => [...templates.values()] }, snapshot: () => { calls.loads++; return { devices, status }; }, loaded: () => true,
    creation: () => ({ tools: over.tools ?? { pio: '/pio/bin/pio', cubemx: '/opt/STM32CubeMX' }, fs: { exists: async f => taken.has(f), isDirectory: async f => dirs.has(f) }, isStm32Project: async f => f === '/work/stm', remote: over.remote }),
    language: over.language ?? 'zh-cn', ...over
  }, initial);
  return { s, model, calls, set(d, st) { devices = d; status = st; } };
}

test('opens on favorites when there are any, otherwise recents, otherwise PlatformIO boards', async () => {
  const e = env();
  assert.equal((await e.model.view()).sections.find(s => s.selected)!.id, 'pio-board');
  await new RecentDevices(e.s).record({ kind: 'pio-board', id: 'uno', name: 'Uno' });
  assert.equal((await e.model.view()).sections.find(s => s.selected)!.id, 'recent');
  await e.model.toggleFavorite({ kind: 'pio-board', id: 'esp32dev' }, 'ESP32 Dev Module');
  const view = await e.model.view();
  assert.equal(view.sections.find(s => s.selected)!.id, 'favorites'); assert.deepEqual(view.rows.map(r => r.id), ['esp32dev']);
});

test('the star saves at once, shows in every list, and unstarring removes it without any apply step', async () => {
  const e = env();
  assert.equal(await e.model.toggleFavorite({ kind: 'pio-board', id: 'uno' }, 'Arduino Uno'), true);
  assert.ok(e.s.data['sakuraAtelier.favoriteDevices']);
  e.model.setSection('all'); assert.equal((await e.model.view()).rows.find(r => r.id === 'uno')!.favorite, true);
  assert.equal(await e.model.toggleFavorite({ kind: 'pio-board', id: 'uno' }, 'Arduino Uno'), false);
  assert.equal((await e.model.view()).rows.find(r => r.id === 'uno')!.favorite, false);
});

test('favorites survive switching workspace: a new wizard on the same global store still shows them', async () => {
  const shared = store();
  await env(undefined, {}, shared).model.toggleFavorite({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB');
  const other = env(undefined, {}, shared);
  assert.deepEqual((await other.model.view()).rows.map(r => r.id), ['nucleo_g071rb']);
});

test('favorites stay, marked "toolchain not installed" in Chinese, when PlatformIO is unavailable', async () => {
  const e = env({ templateId: 'platformio.board' });
  await e.model.toggleFavorite({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB');
  e.set([], new Map([['pio-board', { state: 'unavailable', reason: 'no-cli' }]]));
  const row = (await e.model.view()).rows[0];
  assert.equal(row.id, 'nucleo_g071rb'); assert.equal(row.badge, '工具链未安装'); assert.equal(row.badgeKind, 'warn');
  assert.equal(new DeviceFavorites(e.s).list().length, 1);
});

test('searching is in memory: many keystrokes never reload providers beyond one snapshot read each', async () => {
  const e = env(); let providerLoads = 0;
  const provider: DeviceProvider = { id: 'p', label: 'p', kinds: ['pio-board'], load: async () => { providerLoads++; return { devices: boards, status: { state: 'ready' } }; } };
  const catalog = new DeviceCatalog([provider]); await catalog.load();
  const model = env(undefined, { snapshot: () => catalog.snapshot() }).model;
  for (const q of ['n', 'nu', 'nuc', 'nucleo', 'nucleo g0']) { model.setQuery(q); await model.view(); }
  assert.equal(providerLoads, 1);
  model.setQuery('nucleo g0'); model.setSection('all');
  assert.deepEqual((await model.view()).rows.map(r => r.id).sort(), ['nucleo_g071rb', 'nucleo_g0b1re']);
  void e;
});

test('an STM32 MCU is a separate device: the PlatformIO template never accepts it, the STM32 template does', async () => {
  const e = env();
  e.model.selectTemplate('platformio.board'); e.model.selectDevice({ kind: 'stm32-mcu', id: 'STM32G0B1RETx' }, 'STM32G0B1RETx'); e.model.setName('x'); e.model.setParentDir('/work');
  const pio = await e.model.view(); assert.equal(pio.canCreate, false); assert.ok(pio.blockers.some(b => b.includes('不会被当作 PlatformIO 开发板 ID')));
  e.model.selectTemplate('stm32.cubemx');
  assert.equal((await e.model.view()).device?.id, 'STM32G0B1RETx', 'device kind is accepted by the STM32 template and kept');
  e.model.setName('motor'); e.model.setParentDir('/work');
  assert.equal((await e.model.view()).canCreate, true);
  assert.equal(e.model.state.device?.id, 'STM32G0B1RETx');
});

test('choosing a board fills the framework when it is the only one, restores the last one used, and otherwise asks', async () => {
  const e = env();
  e.model.selectDevice({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB'); assert.equal(e.model.state.framework, '');
  e.model.selectDevice({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB', 'stm32cube'); assert.equal(e.model.state.framework, 'stm32cube');
  e.model.selectDevice({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB', 'not-supported'); assert.equal(e.model.state.framework, '');
  const view = await e.model.view(); assert.ok(view.frameworks.includes('arduino') && view.needsFramework);
});

test('a complete PlatformIO choice can be created; the existing folder case is blocked in Chinese', async () => {
  const e = env();
  e.model.selectDevice({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB', 'stm32cube'); e.model.setParentDir('/work'); e.model.setName('blink');
  const ok = await e.model.view(); assert.equal(ok.canCreate, true); assert.deepEqual(ok.blockers, []);
  e.model.setName('taken');
  const taken = await e.model.view(); assert.equal(taken.canCreate, false); assert.ok(taken.blockers[0].includes('不会覆盖已有文件'));
});

test('a pristine form does not complain about a name and location the user has not reached', async () => {
  const e = env(); e.model.selectDevice({ kind: 'pio-board', id: 'uno' }, 'Uno', 'arduino');
  assert.deepEqual((await e.model.view()).blockers, []);
});

test('favorite template: save the combination, then picking it restores device, framework and options', async () => {
  const shared = store();
  const first = env(undefined, {}, shared);
  first.model.selectDevice({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB', 'stm32cube'); first.model.setOption('monitorSpeed', '115200');
  assert.equal((await first.model.view()).templateFavorite.can, true);
  assert.equal(await first.model.toggleTemplateFavorite(), true);
  const second = env(undefined, {}, shared);
  const view = await second.model.view(); assert.equal(view.favoriteTemplates.length, 1); assert.deepEqual(view.favoriteTemplates[0].problems, []);
  const problems = second.model.applyFavorite(view.favoriteTemplates[0].id);
  assert.deepEqual(problems, []);
  assert.deepEqual([second.model.state.device?.id, second.model.state.framework, second.model.state.options], ['nucleo_g071rb', 'stm32cube', { monitorSpeed: '115200' }]);
  assert.match((await second.model.view()).notice ?? '', /已从“.*”恢复配置/);
  assert.equal(shared.data['sakuraAtelier.favoriteTemplates'] !== undefined, true);
  assert.equal(JSON.stringify(shared.data['sakuraAtelier.favoriteTemplates']).includes('/work'), false, 'no path is stored in a favorite template');
});

test('a favorite template that cannot be used right now is shown with a reason and a fix in Chinese, and is not removed', async () => {
  const e = env(); e.model.selectDevice({ kind: 'pio-board', id: 'uno' }, 'Uno', 'arduino'); await e.model.toggleTemplateFavorite();
  e.set([], new Map([['pio-board', { state: 'unavailable', reason: 'no-cli' }]]));
  const view = await e.model.view();
  assert.equal(view.favoriteTemplates[0].problems[0].text, '暂时无法列出 PlatformIO 开发板，因此无法检查已收藏的开发板。');
  assert.match(view.favoriteTemplates[0].problems[0].fix, /嵌入式工具/);
  assert.equal(new FavoriteTemplates(e.s).list().length, 1);
});

test('recents are recorded only after a successful creation', async () => {
  const e = env(); e.model.selectDevice({ kind: 'pio-board', id: 'uno' }, 'Uno', 'arduino');
  assert.deepEqual(new RecentDevices(e.s).list(), []);
  await e.model.recordSuccess(); assert.deepEqual(new RecentDevices(e.s).list().map(r => r.id), ['uno']);
});

test('a draft round-trips: after the panel is reopened the same choices come back', async () => {
  const e = env(); e.model.selectDevice({ kind: 'pio-board', id: 'nucleo_g071rb' }, 'Nucleo G071RB', 'stm32cube'); e.model.setName('blink'); e.model.setParentDir('/work'); e.model.setQuery('nucleo'); e.model.setSection('all'); e.model.setOption('sampleCode', true);
  const saved = JSON.parse(JSON.stringify(e.model.state));
  const reopened = env(saved);
  assert.deepEqual(reopened.model.state, e.model.state);
  const view = await reopened.model.view(); assert.equal(view.name, 'blink'); assert.equal(view.query, 'nucleo'); assert.equal(view.device?.id, 'nucleo_g071rb'); assert.equal(view.canCreate, true);
});

test('stored drafts are validated: junk, unknown templates and unsafe values are dropped', () => {
  const s = sanitizeState({ templateId: 'nope', device: { kind: 'pio-board', id: '/x' }, framework: '../x', name: 'a\nb', section: 'evil', options: { token: 'x', monitorSpeed: '115200' }, extra: 1 }, id => templates.has(id));
  assert.deepEqual(s, { templateId: 'platformio.board', query: '', framework: '', options: { monitorSpeed: '115200' }, name: '', parentDir: '' });
  assert.equal(sanitizeState(null, id => templates.has(id)).templateId, 'platformio.board');
});

test('messages from the webview are shape-checked before they can change anything', () => {
  assert.deepEqual(parseMessage({ type: 'toggleFavorite', ref: { kind: 'pio-board', id: 'uno' }, name: 'Uno' }), { type: 'toggleFavorite', ref: { kind: 'pio-board', id: 'uno' }, name: 'Uno' });
  for (const bad of [null, 5, {}, { type: 'rm' }, { type: 'toggleFavorite', ref: { kind: 'pio-board', id: '/etc' } }, { type: 'section', id: 'x' }, { type: 'search', value: 'a\nb' }, { type: 'search', value: 'x'.repeat(101) }, { type: 'option', key: 'k', value: { a: 1 } }, { type: 'addManual', kind: 'pio-board', text: 'x' }, { type: 'selectTemplate' }]) { assert.equal(parseMessage(bad), undefined, JSON.stringify(bad)); }
  assert.deepEqual(parseMessage({ type: 'addManual', kind: 'stm32-mcu', text: 'STM32G0B1RETx' }), { type: 'addManual', kind: 'stm32-mcu', text: 'STM32G0B1RETx' });
});

test('a typed STM32 part number is validated, starred and selected; a board name is refused as an MCU', async () => {
  const e = env({ templateId: 'stm32.cubemx' });
  assert.match(await e.model.addManual('stm32-mcu', 'NUCLEO-G071RB') ?? '', /not an STM32 part number/);
  assert.equal(await e.model.addManual('stm32-mcu', 'STM32G0B1RETx'), undefined);
  assert.equal(e.model.state.device?.id, 'STM32G0B1RETx'); assert.ok(new DeviceFavorites(e.s).isFavorite({ kind: 'stm32-mcu', id: 'STM32G0B1RETx' }));
});

test('STM32CubeMX template: remote windows and a missing classic CubeMX block generation with Chinese diagnostics', async () => {
  const remote = env({ templateId: 'stm32.cubemx', device: { kind: 'stm32-mcu', id: 'STM32G0B1RETx' }, name: 'motor', parentDir: '/work' }, { remote: true });
  const rv = await remote.model.view(); assert.equal(rv.canCreate, false); assert.ok(rv.blockers.some(b=>b.includes('本地工作区')));
  const none = env({ templateId: 'stm32.cubemx', device: { kind: 'stm32-mcu', id: 'STM32G0B1RETx' }, name: 'motor', parentDir: '/work' }, { tools: {} });
  const nv=await none.model.view(); assert.equal(nv.canCreate,false); assert.ok(nv.blockers.some(b=>b.includes('经典 STM32CubeMX')));
});

test('importing an existing STM32 project needs only the folder', async () => {
  const e = env({ templateId: 'stm32.import', parentDir: '/work/stm' });
  const view = await e.model.view(); assert.equal(view.canCreate, true); assert.deepEqual(view.rows, []);
  e.model.setParentDir('/work'); assert.ok((await e.model.view()).blockers[0].includes('不是 STM32 项目'));
});

test('every label, section, template, blocker, warning and problem has a Chinese translation, and key actions are not left in English', async () => {
  for (const key of wizardLabelKeys) { assert.ok(wizardChinese[key] ?? embeddedChinese[key], `label: ${key}`); }
  for (const code of ['template', 'name', 'parent', 'exists', 'device-required', 'device-kind', 'board-unknown', 'framework', 'option', 'no-pio', 'not-stm32']) { assert.ok(wizardChinese[`blocker.${code}`], code); }
  for (const code of ['remote-cubemx', 'no-cubemx']) { assert.ok(wizardChinese[`warning.${code}`], code); }
  for (const code of ['template-missing', 'device-unavailable', 'device-unknown', 'framework-unsupported']) { assert.ok(wizardChinese[`problem.${code}`] && wizardChinese[`fix.${code}`], code); }
  const e = env(); const view = await e.model.view();
  for (const t of view.templates) { assert.ok(/[一-鿿]/.test(t.label + t.description) || t.label === 'STM32CubeMX 项目', t.id); }
  for (const s of view.sections) { assert.ok(/[一-鿿]/.test(s.label) || s.label === 'STM32 MCU', s.id); }
  for (const key of ['Create project', 'Cancel', 'Browse...', 'Reload devices', 'Add to favorites', 'Remove from favorites', 'Save this configuration as favorite']) { assert.ok(/[一-鿿]/.test(view.labels[key]), key); }
  assert.equal(view.labels['Create project'], '创建项目'); assert.equal(view.labels['Add to favorites'], '收藏'); assert.equal(view.labels['Remove from favorites'], '取消收藏');
  const english = await env(undefined, { language: 'en' }).model.view(); assert.equal(english.labels['Create project'], 'Create project');
  for (const [key, value] of Object.entries(wizardChinese)) { assert.deepEqual(key.match(/\{\d+\}/g) ?? [], value.match(/\{\d+\}/g) ?? [], key); }
  assert.equal(wizardText('zh-cn', 'Created {0}.', '/x'), '已创建 /x。');
});

test('webview shell is safe and themed: nonce-only script, no inline handlers or data, theme variables, responsive, codicons, accessible stars', () => {
  const html = renderWizardHtml({ nonce: 'NONCE', cspSource: 'vscode-resource:', codiconUri: 'vscode-resource:/media/codicon.css', cssLanguage: 'zh-CN', title: '新建项目' });
  assert.ok(html.includes("script-src 'nonce-NONCE'") && html.includes("default-src 'none'") && html.includes('font-src vscode-resource:'));
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/<script[\s\S]*<\/script>/, '')));
  assert.ok(html.includes('var(--vscode-editor-background)') && html.includes('@media (max-width: 900px)') && html.includes('codicon.css'));
  assert.ok(!/#[0-9a-f]{6}\b/i.test(html.replace(/<script[\s\S]*<\/script>/, '')), 'no hard-coded colors');
  assert.ok(wizardScript.includes('star-full') && wizardScript.includes('star-empty') && wizardScript.includes("'aria-pressed'") && wizardScript.includes('ArrowDown'));
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(/.test(wizardScript), 'data is only ever set through textContent / append');
  assert.ok(wizardScript.includes('setTimeout') && wizardScript.includes('200'), 'search is debounced');
});

test('the manifest adds the wizard to File > New File and the command palette, and it does not need an open workspace', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  assert.deepEqual(manifest.contributes.menus['file/newFile'], [{ command: 'sakuraAtelier.newProject', group: 'file' }]);
  const command = manifest.contributes.commands.find((c: { command: string }) => c.command === 'sakuraAtelier.newProject');
  const nls = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.nls.json'), 'utf8'));
  assert.equal(command.title, '%command.sakuraAtelier.newProject%');
  assert.equal(nls[command.title.slice(1, -1)], 'Sakura Atelier：新建项目…');
  assert.ok(!JSON.stringify(manifest.contributes.menus['file/newFile']).includes('workspace'));
  assert.ok(!(manifest.contributes.menus.commandPalette ?? []).some((m: { command: string; when?: string }) => m.command === 'sakuraAtelier.newProject' && /workspace/i.test(m.when ?? '')));
  assert.deepEqual(manifest.activationEvents, ['onStartupFinished']);
  const source = readFileSync(path.resolve(__dirname, '../../src/embedded/projects/wizardPanel.ts'), 'utf8');
  assert.ok(!/workspaceFolders\?*\.length\s*\)?\s*\{?\s*throw/.test(source));
  const files = readFileSync(path.resolve(__dirname, '../../src/embedded/projects/wizardPanel.ts'), 'utf8');
  assert.ok(!/\.vscode/.test(files) && !/getConfiguration\([^)]*\)\.update/.test(files), 'the wizard does not write VS Code settings');
});
