import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as assert from 'node:assert/strict';
import { chromium, expect, Frame, Page } from '@playwright/test';

export async function run(): Promise<void> {
  const root = process.env.SAKURA_TEST_WORKSPACE!;
  const evidence = path.join(os.tmpdir(), 'sakura-wizard-evidence');
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(root, 'wizard-fixture.ioc'), 'Mcu.Name=STM32F401RET6\nMcu.UserName=STM32F401RET6\nProjectManager.ProjectName=Fixture\n');
  const extension = vscode.extensions.getExtension('ExMikuPro.sakura-atelier');
  assert.ok(extension); await extension.activate();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.SAKURA_TEST_CDP_PORT}`);
  const page = browser.contexts()[0].pages()[0];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function wizard(): Promise<Frame> {
    await vscode.commands.executeCommand('sakuraAtelier.newProject');
    let frame: Frame | undefined;
    await expect.poll(async () => {
      for (const candidate of page.frames()) {
        if (await candidate.locator('#search').count().catch(() => 0)) { frame = candidate; return true; }
      }
      return false;
    }, { timeout: 30000 }).toBe(true);
    return frame!;
  }
  async function screenshot(page: Page, name: string) { await page.screenshot({ path: path.join(evidence, name + '.png') }); }
  let frame = await wizard();
  await expect(frame.locator('h1').first()).toHaveText('新建嵌入式项目');
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
  await expect(frame.locator('#detail')).toContainText('SDK 与工具链');
  await expect(frame.locator('#create')).toBeDisabled();
  await frame.locator('#nav button').filter({ hasText: 'STM32CubeMX' }).first().click();
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
  await expect(frame.locator('#create')).toBeEnabled();
  await frame.locator('#create').click();
  await expect.poll(() => fs.stat(path.join(root, 'HostCreatedProject2')).then(s => s.isDirectory(), () => false)).toBe(true);
  assert.equal(await fs.readFile(path.join(root, 'wizard-fixture.ioc'), 'utf8'), 'Mcu.Name=STM32F401RET6\nMcu.UserName=STM32F401RET6\nProjectManager.ProjectName=Fixture\n');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify({ platform: process.platform, arch: process.arch, vscode: vscode.version, status: 'passed', checks: ['real command and Webview', 'Chinese UI', 'SDK availability', 'device search', 'one-click favorite', 'favorite templates', 'draft restore', 'existing directory protection', 'directory creation', 'dark/light themes', 'narrow layout'], errors }, null, 2));
  console.log('PASS actual wizard UI; evidence: ' + evidence);
  // Extension test runner closes this disposable window after run() returns.
}
