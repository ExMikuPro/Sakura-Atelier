import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseIoc } from '../src/embedded/stm32/ioc';
import { buildViewModel, decideLaunch, escapeHtml, renderIocPage } from '../src/embedded/stm32/iocView';
import { resolveUiLanguage, translateEmbedded, embeddedChinese } from '../src/embedded/strings';

const ioc = path.resolve(__dirname, '../../test/fixtures/embedded/stm32-cubemx/stm32-cubemx.ioc');
const info = parseIoc(fs.readFileSync(ioc, 'utf8'));
import type { LaunchContext } from '../src/embedded/stm32/iocView';
const local: LaunchContext = { scheme: 'file', trusted: true, cubemxPath: '/opt/ST/STM32CubeMX' };
const page = (context: LaunchContext = local, language: 'zh-cn' | 'en' = 'zh-cn') => renderIocPage(buildViewModel('/work/空 格/a b.ioc', info, context), language, 'NONCE', 'vscode-resource:');

test('launch is allowed only for a trusted local file with a located CubeMX, and passes the path as one argument', () => {
  assert.deepEqual(decideLaunch(local, '/work/空 格/a b.ioc'), { ok: true, command: '/opt/ST/STM32CubeMX', args: ['/work/空 格/a b.ioc'] });
});

test('a remote or virtual workspace never hands a path to a local CubeMX', () => {
  for (const context of [{ ...local, remoteName: 'ssh-remote' }, { ...local, remoteName: 'wsl' }, { ...local, remoteName: 'dev-container' }, { ...local, scheme: 'vscode-remote' }, { ...local, scheme: 'vscode-vfs' }]) {
    assert.deepEqual(decideLaunch(context, '/x.ioc'), { ok: false, reason: 'remote' });
  }
});

test('untrusted workspaces and a missing CubeMX disable launch with a reason', () => {
  assert.deepEqual(decideLaunch({ ...local, trusted: false }, '/x.ioc'), { ok: false, reason: 'untrusted' });
  assert.deepEqual(decideLaunch({ ...local, cubemxPath: undefined }, '/x.ioc'), { ok: false, reason: 'missing' });
});

test('page shows file name, MCU, CubeMX status and the two required buttons in Chinese', () => {
  const html = page();
  for (const text of ['a b.ioc', 'STM32G0B1RETx', 'STM32G0B1RET6', '已安装', '使用 STM32CubeMX 打开', '作为文本打开', '手动定位 STM32CubeMX…', '只有主动']) { assert.ok(html.includes(text), text); }
  assert.ok(!/id="open-cubemx" disabled/.test(html));
});

test('page without CubeMX or on a remote file disables the launch button and explains why, but keeps Open as text', () => {
  const missing = page({ ...local, cubemxPath: undefined });
  assert.match(missing, /id="open-cubemx" disabled/); assert.ok(missing.includes('未找到 STM32CubeMX')); assert.ok(missing.includes('id="open-text"'));
  const remote = page({ ...local, remoteName: 'ssh-remote' });
  assert.match(remote, /id="open-cubemx" disabled/); assert.ok(remote.includes('远程或虚拟工作区'));
});

test('an unrecognized MCU is shown as such, and a board name is not shown as the MCU', () => {
  const html = renderIocPage(buildViewModel('/x.ioc', parseIoc('Mcu.UserName=NUCLEO-G071RB\n'), local), 'zh-cn', 'N', 'c');
  assert.ok(html.includes('未识别')); assert.ok(!html.includes('NUCLEO-G071RB'));
  assert.ok(renderIocPage(buildViewModel('/x.ioc', undefined, local), 'zh-cn', 'N', 'c').includes('未识别'));
});

test('page is safe: nonce-only scripts, no inline handlers, escaped values', () => {
  const html = renderIocPage(buildViewModel('/x/<img src=x onerror=alert(1)>.ioc', { ...info, mcu: 'STM32F4"><script>', board: 'B&B' }, { ...local, cubemxPath: '/a/"><b>' }), 'en', 'NONCE', 'vscode-resource:');
  assert.ok(html.includes("script-src 'nonce-NONCE'") && html.includes("default-src 'none'"));
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')));
  assert.ok(!html.includes('<img') && !html.includes('"><b>') && !html.includes('<script>alert'));
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('English page uses English text and the language setting is resolved like the shared dictionary', () => {
  assert.ok(page(local, 'en').includes('Open with STM32CubeMX'));
  assert.equal(resolveUiLanguage(undefined, 'en'), 'zh-cn'); assert.equal(resolveUiLanguage('en', 'zh-cn'), 'en');
  assert.equal(resolveUiLanguage('auto', 'zh-tw'), 'zh-cn'); assert.equal(resolveUiLanguage('auto', 'fr'), 'en');
  assert.equal(translateEmbedded('zh-cn', 'Could not start STM32CubeMX: {0}', 'boom'), '无法启动 STM32CubeMX：boom');
  assert.equal(translateEmbedded('zh-cn', 'Unlisted text'), 'Unlisted text');
});

test('every translated entry keeps its placeholders', () => {
  for (const [key, value] of Object.entries(embeddedChinese)) { assert.deepEqual(key.match(/\{\d+\}/g) ?? [], value.match(/\{\d+\}/g) ?? [], key); }
});

test('the manifest contributes the .ioc custom editor as a read-only optional editor, and nothing launches on open', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  const editor = manifest.contributes.customEditors.find((e: { viewType: string }) => e.viewType === 'sakuraAtelier.iocViewer');
  assert.deepEqual(editor.selector, [{ filenamePattern: '*.ioc' }]); assert.equal(editor.priority, 'option');
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/embedded/stm32/iocEditor.ts'), 'utf8');
  assert.match(source, /implements vscode\.CustomReadonlyEditorProvider/);
  // spawn appears only in the message handler for the click, never in open/resolve setup.
  const before = source.slice(0, source.indexOf("type === 'openCubeMX'"));
  assert.ok(!/spawn\(/.test(before));
});
