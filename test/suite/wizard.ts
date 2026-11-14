import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as assert from 'node:assert/strict';
import { chromium, expect, Frame, Page } from '@playwright/test';

export async function run(): Promise<void> {
  const root = process.env.SAKURA_TEST_WORKSPACE!;
  const evidence = path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'sakura-wizard-evidence');
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(root, 'wizard-fixture.ioc'), 'Mcu.Name=STM32F401RET6\nMcu.UserName=STM32F401RET6\nProjectManager.ProjectName=Fixture\n');
  const extension = vscode.extensions.getExtension('ExMikuPro.sakura-atelier');
  assert.ok(extension); await extension.activate();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.SAKURA_TEST_CDP_PORT}`);
  const page = browser.contexts()[0].pages()[0];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function wizard(open = true): Promise<Frame> {
    if (open) await vscode.commands.executeCommand('sakuraAtelier.newProject');
    let frame: Frame | undefined;
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.locator('.wizard #detail').count().catch(() => 0) && await candidate.frameElement().then(element => element.isVisible()).catch(() => false)) { frame = candidate; return true; }
      }
      return false;
    }, { timeout: 30000 }).toBe(true);
    return frame!;
  }
  async function screenshot(page: Page, name: string) { await page.screenshot({ path: path.join(evidence, name + '.png') }); }
  try {
  const source = path.join(root, 'overview-fixture.py');
  await fs.writeFile(source, 'print("overview fixture")\n');
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(source));
  await vscode.commands.executeCommand('sakuraAtelier.manageToolchains');
  let overview: Frame | undefined;
  await expect.poll(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.locator('#main .environment-table').count().catch(() => 0)) { overview = candidate; return true; }
    }
    return false;
  }, { timeout: 30000 }).toBe(true);
  await expect(overview!.locator('#main .environment-table tr')).toHaveCount(8);
  await expect(overview!.locator('#list .environment-table')).toHaveCount(0);
  await screenshot(page, 'overview-native-fixed');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await expect.poll(() => vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview).toBe(false);
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  // This is the same picker reached through File > New File..., not the top-level native File menu.
  void vscode.commands.executeCommand('welcome.showNewFileEntries');
  const entry = page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: /Sakura Atelier.*(?:新建项目|New Project)/ });
  await screenshot(page, 'new-file-menu-entry');
  await expect(entry).toBeVisible({ timeout: 30000 });
  await screenshot(page, 'new-file-menu-entry');
  await entry.click();
  let frame = await wizard(false);
  await expect(frame.locator('h1').first()).toHaveText('新建项目');
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
  await expect(frame.locator('#detail')).toContainText('SDK 与工具链');
  await expect(frame.locator('#create')).toBeDisabled();
  await frame.locator('#nav button').filter({ hasText: '空项目' }).click();
  await expect(frame.locator('.project-files')).toContainText('不生成任何文件');
  for (const label of ['Python', 'JavaScript / Node.js', 'TypeScript', 'Go', 'Rust / Cargo', 'C 项目', 'C++', 'C# / .NET', 'Java 项目']) {
    await expect(frame.locator('#nav button').filter({ hasText: label }).first()).toBeVisible();
  }
  await frame.locator('#nav button').filter({ hasText: 'Python 项目' }).first().click();
  await expect(frame.locator('.project-files')).toContainText('src/main.py');
  await expect(frame.locator('.project-files')).toContainText('.vscode/sakura-atelier.json');
  await frame.locator('#name').fill('LanguageHostPython');
  await frame.locator('#name').press('Tab');
  await expect(frame.locator('#create')).toBeEnabled();
  await frame.locator('#create').click();
  await expect.poll(() => fs.stat(path.join(root, 'LanguageHostPython/src/main.py')).then(s => s.isFile(), () => false)).toBe(true);
  // File writes precede draft persistence and the completion notification.
  // A first source file is not proof that the remaining files have been written.
  await expect(page.locator('.notification-list-item').filter({ hasText: 'LanguageHostPython' })).toBeVisible({ timeout: 30000 });
  const projectConfig = JSON.parse(await fs.readFile(path.join(root, 'LanguageHostPython/.vscode/sakura-atelier.json'), 'utf8'));
  assert.equal(projectConfig.configurations[0].templateId, 'python.script');
  await vscode.commands.executeCommand('notifications.clearAll');
  await expect.poll(async () => frame.isDetached() || !await frame.frameElement().then(element => element.isVisible()).catch(() => false), { timeout: 30000 }).toBe(true);
  frame = await wizard();
  const stm32 = frame.locator('#nav button').filter({ hasText: 'STM32CubeMX' }).first();
  await stm32.click();
  await expect(stm32).toHaveAttribute('aria-pressed', 'true');
  await frame.locator('#tabs button').filter({ hasText: 'STM32 MCU' }).click();
  await frame.locator('#search').fill('F401');
  const row = frame.locator('#rows .row').filter({ hasText: 'STM32F401RET6' });
  await expect(row).toHaveCount(1);
  await row.locator('.star').click();
  await expect(row.locator('.star')).toHaveAttribute('aria-pressed', 'true');
  await row.locator('.item').click();
  await frame.locator('#name').fill('HostCreatedProject');
  await frame.locator('#name').press('Tab');
  await expect(frame.locator('#dir')).toHaveValue(root);
  await frame.getByRole('button', { name: '收藏此项目配置', exact: true }).click();
  await expect(frame.locator('#nav')).toContainText('STM32F401RET6');
  const editor = await vscode.workspace.openTextDocument({ content: 'wizard hide/reveal fixture', language: 'plaintext' });
  await vscode.window.showTextDocument(editor);
  frame = await wizard();
  await expect(frame.locator('#name')).toHaveValue('HostCreatedProject');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Workspace);
  await screenshot(page, 'wizard-dark');
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Workspace);
  await expect(frame.locator('body')).toHaveClass(/vscode-light/);
  await screenshot(page, 'wizard-light');
  await page.setViewportSize({ width: 700, height: 850 });
  await expect(frame.locator('#create')).toBeVisible();
  await screenshot(page, 'wizard-narrow');
  const widths = await frame.locator('body').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: [...el.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > el.clientWidth + 1).map(e => ({tag: e.tagName, cls: e.className, width: e.getBoundingClientRect().width})).slice(0, 12) }));
  assert.ok(widths.scroll <= widths.client + 1, JSON.stringify(widths));
  await screenshot(page, 'wizard-narrow');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  frame = await wizard();
  await expect(frame.locator('#name')).toHaveValue('HostCreatedProject');
  await expect(frame.locator('#nav')).toContainText('STM32F401RET6');
  await fs.mkdir(path.join(root, 'HostCreatedProject'));
  await frame.locator('#name').fill('HostCreatedProject2'); await frame.locator('#name').press('Tab');
  await frame.locator('#name').fill('HostCreatedProject'); await frame.locator('#name').press('Tab');
  await expect(frame.locator('#name')).toHaveValue('HostCreatedProject');
  await expect(frame.locator('#create')).toBeDisabled();
  await expect(frame.locator('#detail')).toContainText('已存在同名文件夹');
  await frame.locator('#name').fill('HostCreatedProject2'); await frame.locator('#name').press('Tab');
  // Native UI checks do not require firmware packages or run a real CubeMX generator.
  await expect(frame.locator('#detail')).toContainText('CMake');
  await expect.poll(() => fs.stat(path.join(root, 'HostCreatedProject2')).then(() => false, () => true)).toBe(true);
  assert.equal(await fs.readFile(path.join(root, 'wizard-fixture.ioc'), 'utf8'), 'Mcu.Name=STM32F401RET6\nMcu.UserName=STM32F401RET6\nProjectManager.ProjectName=Fixture\n');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch, vscode: vscode.version, status: 'passed', checks: ['language types and actual Python project creation', 'overview in main pane', 'File > New File picker entry', 'real command and Webview', 'Chinese UI', 'SDK availability', 'device search', 'one-click favorite', 'favorite templates', 'draft restore', 'existing directory protection', 'directory creation', 'dark/light themes', 'narrow layout'], errors }, null, 2));
  console.log('PASS actual wizard UI; evidence: ' + evidence);
  } catch (error) {
    await screenshot(page, 'failure').catch(() => {});
    for (const candidate of page.frames()) {
      if (!await candidate.locator('.wizard').count().catch(() => 0)) continue;
      console.log('Wizard failure state:', JSON.stringify({
        selected: await candidate.locator('#nav button[aria-pressed="true"]').allTextContents().catch(() => []),
        detail: await candidate.locator('#detail').textContent().catch(() => ''),
        tabs: await candidate.locator('#tabs').allTextContents().catch(() => []),
      }));
    }
    throw error;
  }
  // Extension test runner closes this disposable window after run() returns.
}
