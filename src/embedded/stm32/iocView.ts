import * as path from 'node:path';
import type { IocInfo } from './ioc';
import { translateEmbedded, UiLanguage } from '../strings';

export interface LaunchContext { scheme: string; remoteName?: string; trusted: boolean; cubemxPath?: string }
export type LaunchDecision = { ok: true; command: string; args: string[] } | { ok: false; reason: 'remote' | 'untrusted' | 'missing' };

/**
 * Whether STM32CubeMX may be started for this file. A remote or virtual file path is never handed to a locally installed CubeMX,
 * and nothing starts unless the user clicked the button (the caller only asks after a click).
 */
export function decideLaunch(context: LaunchContext, file: string): LaunchDecision {
  if (context.scheme !== 'file' || context.remoteName) { return { ok: false, reason: 'remote' }; }
  if (!context.trusted) { return { ok: false, reason: 'untrusted' }; }
  if (!context.cubemxPath) { return { ok: false, reason: 'missing' }; }
  // Arguments are passed as an array; no shell is involved.
  return { ok: true, command: context.cubemxPath, args: [file] };
}

export interface IocViewModel { fileName: string; info: IocInfo | undefined; cubemx: 'found' | 'missing'; cubemxPath?: string; launch: LaunchDecision }

export function buildViewModel(file: string, info: IocInfo | undefined, context: LaunchContext): IocViewModel {
  return { fileName: path.basename(file), info, cubemx: context.cubemxPath ? 'found' : 'missing', cubemxPath: context.cubemxPath, launch: decideLaunch(context, file) };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Static page: no inline event handlers, a nonce-only script, and every value escaped. */
export function renderIocPage(model: IocViewModel, language: UiLanguage, nonce: string, cspSource: string): string {
  const t = (message: string, ...args: unknown[]) => escapeHtml(translateEmbedded(language, message, ...args));
  const info = model.info;
  const row = (label: string, value: string) => `<tr><th>${t(label)}</th><td>${value}</td></tr>`;
  const text = (value: string | undefined) => value ? escapeHtml(value) : `<span class="muted">${t('Not recognized')}</span>`;
  const notice = model.launch.ok ? '' : `<p class="notice">${t(model.launch.reason === 'remote' ? 'This file is in a remote or virtual workspace. A local STM32CubeMX cannot open a remote path, so launching is disabled. Open the project locally, or use "Open as text".' : model.launch.reason === 'untrusted' ? 'Trust this workspace to launch STM32CubeMX.' : 'STM32CubeMX was not found. Locate it manually; no fixed install path is assumed.')}</p>`;
  return `<!DOCTYPE html>
<html lang="${language === 'zh-cn' ? 'zh-CN' : 'en'}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; max-width: 720px; }
h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 4px; } .sub { color: var(--vscode-descriptionForeground); margin: 0 0 20px; }
table { border-collapse: collapse; width: 100%; margin-bottom: 20px; } th { text-align: left; font-weight: 500; color: var(--vscode-descriptionForeground); padding: 6px 16px 6px 0; width: 9em; vertical-align: top; } td { padding: 6px 0; word-break: break-all; }
.muted { color: var(--vscode-descriptionForeground); } .ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); } .bad { color: var(--vscode-editorWarning-foreground); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
button { font: inherit; padding: 6px 14px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.notice { color: var(--vscode-editorWarning-foreground); } .foot { color: var(--vscode-descriptionForeground); font-size: .9em; }
</style></head><body>
<h1>${t('STM32CubeMX project')}</h1><p class="sub">${t('Classic STM32CubeMX 6.x owns .ioc configuration and code generation.')}</p>
<table>
${row('File name', escapeHtml(model.fileName))}
${row('MCU', text(info?.mcu))}
${info?.partNumber ? row('Part number', escapeHtml(info.partNumber)) : ''}
${info?.family ? row('Family', escapeHtml(info.family)) : ''}
${info?.package ? row('Package', escapeHtml(info.package)) : ''}
${info?.board && info.board !== 'custom' ? row('Board', escapeHtml(info.board)) : ''}
${row('STM32CubeMX', model.cubemx === 'found' ? `<span class="ok">${t('Installed')}</span> <span class="muted">${escapeHtml(model.cubemxPath ?? '')}</span>` : `<span class="bad">${t('Not found')}</span>`)}
</table>
${notice}
<div class="actions">
<button id="open-cubemx" ${model.launch.ok ? '' : 'disabled'}>${t('Open with STM32CubeMX')}</button>
<button id="generate" ${model.launch.ok ? '' : 'disabled'}>${t('Generate CMake project')}</button>
<button id="interactive" class="secondary" ${model.launch.ok ? '' : 'disabled'}>${t('Configure with CLI (-i)')}</button>
<button id="open-text" class="secondary">${t('Open as text')}</button>
<button id="locate" class="secondary">${t('Locate STM32CubeMX...')}</button>
</div>
<p class="foot">${t('CubeMX starts only when you explicitly open, configure or generate the project.')}</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
for (const [id, type] of [['open-cubemx', 'openCubeMX'], ['generate', 'generate'], ['interactive', 'interactive'], ['open-text', 'openText'], ['locate', 'locate']]) { document.getElementById(id).addEventListener('click', () => vscode.postMessage({ type })); }
</script></body></html>`;
}
