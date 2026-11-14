import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { projectLanguages } from '../src/projectScaffolds';
import { builtinProjectTemplates } from '../src/embedded/projects/template';
import { executeCreation, planCreation, CreationContext } from '../src/embedded/projects/creation';
import { ConfigurationStore } from '../src/configurationStore';
import { validateFile } from '../src/configuration';
import { WizardModel } from '../src/embedded/projects/wizardModel';
import { DeviceFavorites } from '../src/embedded/devices/favorites';
import { RecentDevices } from '../src/embedded/devices/recents';
import { FavoriteTemplates } from '../src/embedded/projects/favoriteTemplates';

const memory = () => { const map = new Map<string, unknown>(); return { get: <T>(key: string, fallback?: T): T => (map.get(key) ?? fallback) as T, update: async (key: string, value: unknown) => { map.set(key, value); } }; };
async function fixture(work: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-projects 空格-'));
  try { await work(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const context = (language: string): CreationContext => ({
  template: builtinProjectTemplates.find(t => t.id === 'general.' + language), tools: {}, boards: new Map(),
  fs: { exists: file => fs.lstat(file).then(() => true, () => false), isDirectory: file => fs.stat(file).then(s => s.isDirectory(), () => false) }, isStm32Project: async () => false,
});
const writesOnly = {
  mkdir: (directory: string) => fs.mkdir(directory).then(() => {}),
  writeFile: (file: string, content: string) => fs.writeFile(file, content, { flag: 'wx' }),
  run: async () => { throw new Error('Scaffolding must not execute SDKs or install packages.'); },
  confirm: async () => false, launch: () => { throw new Error('Scaffolding must not launch external applications.'); },
};
test('empty project creates only an empty directory without an SDK and refuses existing content', () => fixture(async root => {
  const request = { templateId: 'general.empty', parentDir: root, name: 'EmptyProject' };
  const plan = await planCreation(request, context('empty'));
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.steps.map(step => step.kind), ['mkdir', 'open']);
  const result = await executeCreation(plan, writesOnly);
  assert.equal(result.open, path.join(root, 'EmptyProject'));
  assert.deepEqual(await fs.readdir(result.target), []);
  await fs.writeFile(path.join(result.target, 'keep.txt'), 'keep');
  assert.ok((await planCreation(request, context('empty'))).blockers.some(b => b.code === 'exists'));
  await assert.rejects(executeCreation(plan, writesOnly));
  assert.equal(await fs.readFile(path.join(result.target, 'keep.txt'), 'utf8'), 'keep');
}));
for (const spec of projectLanguages) {
  test(`${spec.label} creates real source/project files readable by the existing configuration store without an SDK`, () => fixture(async root => {
    const plan = await planCreation({ templateId: 'general.' + spec.language, parentDir: root, name: 'My.Project' }, context(spec.language));
    assert.deepEqual(plan.blockers, []);
    assert.ok(plan.warnings.some(w => w.code === 'no-runtime'));
    assert.ok(!plan.steps.some(s => s.kind === 'run' || s.kind === 'launch-cubemx'));
    const result = await executeCreation(plan, writesOnly);
    assert.equal(result.open, path.join(root, 'My.Project'));
    await fs.stat(path.join(result.target, spec.entry));
    await fs.stat(path.join(result.target, spec.marker));
    const raw = await fs.readFile(path.join(result.target, '.vscode/sakura-atelier.json'), 'utf8');
    const document = validateFile(JSON.parse(raw));
    assert.equal(document.configurations[0].templateId, spec.template);
    assert.equal(document.default, document.configurations[0].id);
    assert.equal(document.configurations[0].cwd, '${workspaceFolder}');
    assert.equal(raw.includes(root), false, 'machine paths must not enter a shared configuration');
    const folder = { name: 'Created', index: 0, uri: { fsPath: result.target, toString: () => 'file://' + result.target } } as unknown as import('vscode').WorkspaceFolder;
    const store = new ConfigurationStore({ globalState: memory(), workspaceState: memory() } as unknown as import('vscode').ExtensionContext);
    assert.deepEqual((await store.read(folder)).document, document);
  }));
}
test('new language project creation rejects an existing directory even when it appears after planning', () => fixture(async root => {
  const plan = await planCreation({ templateId: 'general.python', parentDir: root, name: 'existing' }, context('python'));
  await fs.mkdir(plan.target); await fs.writeFile(path.join(plan.target, 'sentinel'), 'user data');
  await assert.rejects(executeCreation(plan, writesOnly), /EEXIST/);
  assert.equal(await fs.readFile(path.join(plan.target, 'sentinel'), 'utf8'), 'user data');
}));
test('language project favorites and drafts do not require an embedded device or lose their language', async () => {
  const store = memory(); const templates = new Map(builtinProjectTemplates.map(t => [t.id, t]));
  const model = new WizardModel({ favorites: new DeviceFavorites(store), recents: new RecentDevices(store), templates: new FavoriteTemplates(store), projectTemplates: { get: id => templates.get(id), values: () => [...templates.values()] }, snapshot: () => ({ devices: [], status: new Map() }), loaded: () => true, creation: () => ({ ...context('python') }), language: 'zh-cn' }, { templateId: 'general.python', parentDir: '/tmp', name: 'PythonApp' });
  const view = await model.view(); assert.equal(view.needsDevice, false); assert.equal(view.canCreate, true); assert.equal(view.templateFavorite.can, true); assert.ok(view.projectFiles.includes('src/main.py'));
  assert.equal(await model.toggleTemplateFavorite(), true);
  model.selectTemplate('general.go'); assert.equal((await model.view()).templates.find(t => t.selected)?.id, 'general.go');
  model.applyFavorite(new FavoriteTemplates(store).list()[0].id); assert.equal(model.state.templateId, 'general.python');
});
