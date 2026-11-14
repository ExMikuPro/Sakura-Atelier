import { escapeHtml } from '../stm32/iocView';

export interface ShellOptions { nonce: string; cspSource: string; codiconUri: string; cssLanguage: 'zh-CN' | 'en'; title: string }

/** Static shell plus the client script. No text and no data are embedded: the host sends one `view` message and the script renders it with textContent only. */
export function renderWizardHtml(o: ShellOptions): string {
  return `<!DOCTYPE html>
<html lang="${o.cssLanguage}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource} 'nonce-${o.nonce}'; font-src ${o.cspSource}; script-src 'nonce-${o.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="${escapeHtml(o.codiconUri)}" rel="stylesheet">
<title>${escapeHtml(o.title)}</title>
<style nonce="${o.nonce}">${wizardCss}</style></head>
<body>
<div class="wizard" id="app" aria-live="polite">
  <nav class="nav" id="nav"></nav>
  <main class="list" id="list"></main>
  <aside class="detail" id="detail"></aside>
</div>
<script nonce="${o.nonce}">${wizardScript}</script></body></html>`;
}

export const wizardCss = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.wizard { display: grid; grid-template-columns: 220px minmax(260px, 1fr) minmax(300px, 1.1fr); height: 100vh; }
.nav, .list, .detail { overflow: auto; min-width: 0; }
.nav { background: var(--vscode-sideBar-background, transparent); border-right: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); padding: 12px 0; }
.list { padding: 12px 16px; border-right: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); display: flex; flex-direction: column; }
.detail { padding: 12px 20px 24px; }
h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 12px; }
h2 { font-size: .8em; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); margin: 14px 12px 6px; font-weight: 600; }
.nav h2:first-child { margin-top: 0; }
.item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.item:hover { background: var(--vscode-list-hoverBackground); }
.item[aria-selected="true"], .item[aria-pressed="true"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.item .grow { flex: 1; min-width: 0; } .item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: var(--vscode-descriptionForeground); font-size: .9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item[aria-selected="true"] .sub { color: inherit; opacity: .85; }
.count { color: var(--vscode-descriptionForeground); font-size: .85em; }
.warn { color: var(--vscode-editorWarning-foreground); } .ok { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); } .err { color: var(--vscode-errorForeground); }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin: 10px 0; }
.tab { border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); background: transparent; color: inherit; border-radius: 10px; padding: 2px 10px; cursor: pointer; font: inherit; }
.tab[aria-pressed="true"] { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-color: transparent; }
.search { display: flex; gap: 6px; }
.project-files { padding-left: 20px; overflow-wrap: anywhere; }
input[type=text], select { width: 100%; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 8px; border-radius: 2px; }
input:focus-visible, select:focus-visible, button:focus-visible, .item:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.rows { flex: 1; overflow: auto; margin: 0 -16px; } .row { display: flex; align-items: center; } .row .item { flex: 1; min-width: 0; }
.star { border: 0; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 6px 10px; } .star[aria-pressed="true"] { color: var(--vscode-charts-yellow, var(--vscode-foreground)); } .star:hover { color: var(--vscode-foreground); }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 0; text-align: center; }
.field { margin: 10px 0; } .field > label { display: block; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
.inline { display: flex; gap: 6px; align-items: center; }
.inline > input { min-width: 0; flex: 1; }
.inline > button { flex-shrink: 0; }
.warn, .err, .notice { overflow-wrap: anywhere; }
button.btn { font: inherit; padding: 5px 14px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); } button.btn.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } button.btn:disabled { opacity: .5; cursor: not-allowed; }
.steps { list-style: none; margin: 8px 0 16px; padding: 0; } .steps li { display: flex; gap: 8px; padding: 2px 0; color: var(--vscode-descriptionForeground); } .steps li.done { color: var(--vscode-foreground); }
.card { border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); border-radius: 4px; padding: 8px 12px; margin: 10px 0; }
.notice { background: var(--vscode-inputValidation-infoBackground, transparent); border: 1px solid var(--vscode-inputValidation-infoBorder, transparent); padding: 6px 10px; border-radius: 3px; margin: 8px 0; }
pre.preview { margin: 0; white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family); font-size: .9em; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
@media (max-width: 900px) { .wizard { grid-template-columns: minmax(0, 1fr); height: auto; } .nav, .list, .detail { overflow: visible; border-right: 0; } .rows { max-height: 50vh; } .nav { display: flex; flex-wrap: wrap; padding: 8px; } .nav h2 { width: 100%; } .nav .item { width: auto; max-width: 100%; min-width: 0; } .nav > * { min-width: 0; max-width: 100%; } .nav .row { width: 100%; } }
`;

export const wizardScript = `
const vscode = acquireVsCodeApi();
let view; let timer; let clientRevision = 0; let navSignature;
const send = m => vscode.postMessage({ ...m, clientRevision: ++clientRevision });
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === 'class') n.className = v; else if (k.startsWith('aria-')) n.setAttribute(k, String(v)); else if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else if (v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v)); }
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
}
const icon = name => el('span', { class: 'codicon codicon-' + name, 'aria-hidden': 'true' });
const L = k => (view && view.labels[k]) || k;
function renderNav() {
  // Discovery updates must not replace a button between pointer down and click.
  const signature = JSON.stringify([view.templates, view.favoriteTemplates, view.labels]);
  if (signature === navSignature) return;
  navSignature = signature;
  const nav = document.getElementById('nav'); nav.replaceChildren();
  nav.append(el('h2', {}, L('Project types')));
  for (const category of ['general', 'embedded']) {
    nav.append(el('h2', {}, L(category === 'general' ? 'Programming languages' : 'Embedded projects')));
    for (const t of view.templates.filter(t => t.category === category)) nav.append(el('button', { class: 'item', type: 'button', 'aria-pressed': t.selected, title: t.description, on: { click: () => send({ type: 'selectTemplate', id: t.id }) } }, icon(t.icon), el('span', { class: 'grow name' }, t.label)));
  }
  nav.append(el('h2', {}, L('My favorite templates')));
  for (const f of view.favoriteTemplates) {
    const warn = f.problems.length > 0;
    nav.append(el('div', { class: 'row' },
      el('button', { class: 'item', type: 'button', title: f.problems.map(p => p.text + ' ' + p.fix).join('\\n'), on: { click: () => send({ type: 'applyFavorite', id: f.id }) } }, icon(warn ? 'warning' : 'star-full'), el('span', { class: 'grow name' + (warn ? ' warn' : '') }, f.name)),
      el('button', { class: 'star', type: 'button', 'aria-label': L('Remove this favorite configuration'), title: L('Remove this favorite configuration'), on: { click: () => send({ type: 'removeFavoriteTemplate', id: f.id }) } }, icon('close'))));
  }
}
function renderList() {
  const list = document.getElementById('list');
  if (!view.needsDevice) {
    list.replaceChildren(el('h1', {}, L('New project')), el('p', {}, view.description), el('h2', {}, L('Files to create')), view.projectFiles.length ? el('ul', { class: 'project-files' }, view.projectFiles.map(file => el('li', {}, file))) : el('p', { class: 'project-files' }, L('No files will be created.')));
    return;
  }
  let search = document.getElementById('search');
  if (!search) {
    list.replaceChildren(el('h1', {}, L('New project')), el('div', { class: 'search' }, el('input', { id: 'search', type: 'text', 'aria-label': L('Search by name, part number, vendor, platform or board id'), placeholder: L('Search by name, part number, vendor, platform or board id') })), el('div', { class: 'tabs', id: 'tabs', role: 'group' }), el('div', { class: 'rows', id: 'rows', role: 'listbox' }), el('div', { id: 'listfoot' }));
    search = document.getElementById('search');
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => send({ type: 'search', value: search.value }), 200); });
  }
  if (document.activeElement !== search) search.value = view.query;
  search.placeholder = L('Search by name, part number, vendor, platform or board id');
  const tabs = document.getElementById('tabs'); tabs.replaceChildren(...view.sections.map(s => el('button', { class: 'tab', type: 'button', 'aria-pressed': s.selected, on: { click: () => send({ type: 'section', id: s.id }) } }, icon(s.icon), ' ' + s.label + ' ', el('span', { class: 'count' }, String(s.count)))));
  const rows = document.getElementById('rows'); rows.replaceChildren();
  if (view.listMessage) rows.append(el('div', { class: 'empty' }, view.listMessage));
  for (const r of view.rows) {
    rows.append(el('div', { class: 'row', role: 'option', 'aria-selected': r.selected },
      el('button', { class: 'item', type: 'button', 'aria-selected': r.selected, on: { click: () => send({ type: 'selectDevice', ref: { kind: r.kind, id: r.id }, name: r.name }), keydown: e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const all = [...rows.querySelectorAll('.item')]; const i = all.indexOf(e.currentTarget); const next = all[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (next) { next.focus(); e.preventDefault(); } } } } },
        el('span', { class: 'grow' }, el('div', { class: 'name' }, r.name + '  '), el('div', { class: 'sub' }, [r.id, r.subtitle].filter(Boolean).join(' · '))),
        r.badge ? el('span', { class: 'sub ' + (r.badgeKind || '') }, r.badge) : null),
      el('button', { class: 'star', type: 'button', 'aria-pressed': r.favorite, 'aria-label': r.favorite ? L('Remove from favorites') : L('Add to favorites'), title: r.favorite ? L('Remove from favorites') : L('Add to favorites'), on: { click: () => send({ type: 'toggleFavorite', ref: { kind: r.kind, id: r.id }, name: r.name }) } }, icon(r.favorite ? 'star-full' : 'star-empty'))));
  }
  const foot = document.getElementById('listfoot'); foot.replaceChildren();
  if (view.catalogNote) foot.append(el('p', { class: 'sub' }, view.catalogNote));
  const actions = el('div', { class: 'inline' }, el('button', { class: 'btn secondary', type: 'button', on: { click: () => send({ type: 'reload' }) } }, icon('refresh'), ' ' + L('Reload devices')));
  if (view.hasRecents) actions.append(el('button', { class: 'btn secondary', type: 'button', on: { click: () => send({ type: 'clearRecents' }) } }, L('Clear recent devices')));
  foot.append(actions);
  if (view.manualKind) {
    const input = el('input', { type: 'text', 'aria-label': L('Add an STM32 part number manually'), placeholder: L('Add an STM32 part number manually') });
    foot.append(el('div', { class: 'field inline' }, input, el('button', { class: 'btn secondary', type: 'button', on: { click: () => { if (input.value.trim()) send({ type: 'addManual', kind: view.manualKind, text: input.value.trim() }); } } }, L('Add'))));
  }
}
function renderDetail() {
  const d = document.getElementById('detail'); d.replaceChildren();
  d.append(el('h1', {}, L('Steps')), el('ol', { class: 'steps' }, view.steps.map(s => el('li', { class: s.done ? 'done' : '' }, icon(s.done ? 'pass' : 'circle-outline'), s.label))));
  if (view.notice) d.append(el('div', { class: 'notice' }, view.notice));
  if (view.needsDevice) d.append(el('div', { class: 'field' }, el('label', {}, L('Device')), el('div', {}, view.device ? view.device.name + '  ' : L('Select a device'), view.device ? el('span', { class: 'sub' }, [view.device.id, view.device.subtitle].filter(Boolean).join(' · ')) : null)));
  if (view.needsFramework) {
    const select = el('select', { id: 'framework', 'aria-label': L('Framework'), on: { change: e => send({ type: 'framework', value: e.target.value }) } }, el('option', { value: '' }, L('Choose...')), view.frameworks.map(f => el('option', { value: f, selected: f === view.framework }, f)));
    d.append(el('div', { class: 'field' }, el('label', { for: 'framework' }, L('Framework')), select));
  }
  if (view.generator.length) d.append(el('div', { class: 'field' }, el('label', { for: 'generator' }, L('Toolchain in STM32CubeMX')), el('select', { id: 'generator', on: { change: e => send({ type: 'option', key: 'generator', value: e.target.value }) } }, view.generator.map(g => el('option', { value: g, selected: g === (view.options.generator || 'cmake') }, g === 'cmake' ? 'CMake' : g === 'makefile' ? 'Makefile' : 'STM32CubeIDE')))));
  if (view.needsFramework) {
    d.append(el('div', { class: 'field' }, el('label', { for: 'speed' }, L('Monitor speed')), el('input', { id: 'speed', type: 'text', inputmode: 'numeric', value: view.options.monitorSpeed || '', placeholder: '115200', on: { input: e => send({ type: 'option', key: 'monitorSpeed', value: e.target.value }) } })));
    d.append(el('div', { class: 'field inline' }, el('input', { id: 'sample', type: 'checkbox', checked: !!view.options.sampleCode, on: { change: e => send({ type: 'option', key: 'sampleCode', value: e.target.checked }) } }), el('label', { for: 'sample' }, L('Include sample code'))));
  }
  d.append(el('div', { class: 'card' }, el('div', { class: 'sub' }, L('SDK and toolchain')), view.tools.map(t => el('div', {}, icon(t.found ? 'pass' : 'warning'), ' ' + t.label + ' ', el('span', { class: t.found ? 'ok' : 'warn' }, t.found ? L('Found') : L('Not found')), t.path ? el('div', { class: 'sub' }, t.path) : null, t.found ? null : el('button', { class: 'btn secondary', type: 'button', on: { click: () => send({ type: 'locateTools' }) } }, L('Locate...'))))));
  d.append(el('div', { class: 'field' }, el('label', { for: 'name' }, L('Project name')), el('input', { id: 'name', type: 'text', value: view.name, on: { input: e => send({ type: 'name', value: e.target.value }) } })));
  d.append(el('div', { class: 'field' }, el('label', { for: 'dir' }, L('Save location')), el('div', { class: 'inline' }, el('input', { id: 'dir', type: 'text', value: view.parentDir, readonly: true }), el('button', { class: 'btn secondary', type: 'button', on: { click: () => send({ type: 'browse' }) } }, L('Browse...')))));
  for (const b of view.blockers) d.append(el('div', { class: 'err' }, icon('error'), ' ' + b));
  for (const w of view.warnings) d.append(el('div', { class: 'warn' }, icon('warning'), ' ' + w));
  d.append(el('div', { class: 'card' }, el('div', { class: 'sub' }, L('Preview')), el('pre', { class: 'preview' }, view.preview.join('\\n'))));
  d.append(el('div', { class: 'actions' },
    el('button', { class: 'btn', id: 'create', type: 'button', disabled: !view.canCreate, on: { click: () => send({ type: 'create' }) } }, L('Create project')),
    el('button', { class: 'btn secondary', type: 'button', disabled: !view.templateFavorite.can, 'aria-pressed': view.templateFavorite.saved, on: { click: () => send({ type: 'toggleTemplateFavorite' }) } }, icon(view.templateFavorite.saved ? 'star-full' : 'star-empty'), ' ' + (view.templateFavorite.saved ? L('Remove this favorite configuration') : L('Save this configuration as favorite'))),
    el('button', { class: 'btn secondary', type: 'button', on: { click: () => send({ type: 'cancel' }) } }, L('Cancel'))));
}
function render() { document.title = L('New project'); renderNav(); renderList(); renderDetail(); }
window.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'view' || e.data.clientRevision < clientRevision) return;
  const active = document.activeElement; const focus = active && active.id;
  const start = active && active.selectionStart; const end = active && active.selectionEnd;
  view = e.data.view; render();
  if (focus) { const n = document.getElementById(focus); if (n && n.id !== 'search') { n.focus(); if (typeof start === 'number' && typeof n.setSelectionRange === 'function') n.setSelectionRange(start, end); } }
});
send({ type: 'ready' });
`;
