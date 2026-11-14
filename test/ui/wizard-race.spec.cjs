const { test, expect } = require('@playwright/test');
const { WizardModel } = require('../../out/src/embedded/projects/wizardModel');
const { renderWizardHtml } = require('../../out/src/embedded/projects/wizardHtml');
const { builtinProjectTemplates } = require('../../out/src/embedded/projects/template');
const { DeviceFavorites } = require('../../out/src/embedded/devices/favorites');
const { RecentDevices } = require('../../out/src/embedded/devices/recents');
const { FavoriteTemplates } = require('../../out/src/embedded/projects/favoriteTemplates');

test('an older asynchronous wizard response never replaces newer typed input or its focus', async ({ page }) => {
  const data = new Map();
  const store = { get: (key, fallback) => data.get(key) ?? fallback, update: async (key, value) => { data.set(key, value); } };
  const model = new WizardModel({
    favorites: new DeviceFavorites(store), recents: new RecentDevices(store), templates: new FavoriteTemplates(store),
    projectTemplates: { get: id => builtinProjectTemplates.find(t => t.id === id), values: () => builtinProjectTemplates },
    snapshot: () => ({ devices: [], status: new Map() }), loaded: () => true,
    creation: () => ({ tools: {}, fs: { exists: async () => false, isDirectory: async () => true }, isStm32Project: async () => false }), language: 'zh-cn',
  }, { templateId: 'stm32.cubemx', parentDir: '/work', name: 'old' });
  const view = await model.view();
  await page.addInitScript(() => { window.__messages = []; window.acquireVsCodeApi = () => ({ postMessage: message => window.__messages.push(message) }); });
  await page.goto('data:text/html,' + encodeURIComponent(renderWizardHtml({ nonce: 'test', cspSource: 'data:', codiconUri: 'data:text/css,', cssLanguage: 'zh-CN', title: 'Wizard' })));
  const revision = await page.evaluate(() => window.__messages.at(-1).clientRevision);
  await page.evaluate(({ view, revision }) => window.postMessage({ type: 'view', view, clientRevision: revision }, '*'), { view, revision });
  await page.locator('#name').fill('newest-user-input');
  await page.evaluate(({ view, revision }) => window.postMessage({ type: 'view', view, clientRevision: revision }, '*'), { view, revision });
  await expect(page.locator('#name')).toHaveValue('newest-user-input');
  const latest = await page.evaluate(() => window.__messages.at(-1));
  expect(latest).toMatchObject({ type: 'name', value: 'newest-user-input' });
  await page.evaluate(({ view, revision }) => window.postMessage({ type: 'view', view: { ...view, name: 'newest-user-input' }, clientRevision: revision }, '*'), { view, revision: latest.clientRevision });
  await expect(page.locator('#name')).toHaveValue('newest-user-input');
  await expect(page.locator('#name')).toBeFocused();
});
