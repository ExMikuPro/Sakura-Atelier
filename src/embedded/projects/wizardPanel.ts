import { hostToolchains } from '../../environment/registryAccess';
import type { CreationContext } from './creation';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { adapterRegistry } from '../../adapters';
import type { BackendHost } from '../../adapterTypes';
import { DeviceFavorites } from '../devices/favorites';
import { RecentDevices } from '../devices/recents';
import { deviceCatalog } from '../devices/service';
import { Stm32WorkspaceProvider } from '../devices/stm32Devices';
import { createToolRegistry } from '../toolsCommand';
import { nodeRunner } from '../process';
import { stm32Backend } from '../stm32/project';
import { resolveUiLanguage } from '../strings';
import { executeCreation } from './creation';
import { FavoriteTemplates } from './favoriteTemplates';
import { builtinProjectTemplates } from './template';
import { WizardModel, parseMessage } from './wizardModel';
import { renderWizardHtml } from './wizardHtml';
import { wizardText } from './wizardStrings';

const draftKey = 'sakuraAtelier.wizardDraft';
const defaultsKey = 'sakuraAtelier.wizardDefaults';
interface Defaults { parentDir?: string; frameworks?: Record<string, string> }

const host: BackendHost = {
  async readDir(directory) { try { return await fs.readdir(directory); } catch { return []; } },
  async readText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return undefined; } }
};

let current: WizardPanel | undefined;

/** Opens the unified new-project wizard. Works from a window with no folder open. */
export async function openNewProject(context: vscode.ExtensionContext): Promise<void> {
  if (current) { current.reveal(); return; }
  current = new WizardPanel(context, () => { current = undefined; });
  await current.start();
}

class WizardPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly model: WizardModel;
  private loaded = false;
  private disposed = false;
  private clientRevision = 0;
  private viewGeneration = 0;
  private completed = false;
  private tools: CreationContext['tools'] = {};
  private readonly language = () => resolveUiLanguage(vscode.workspace.getConfiguration('sakuraAtelier').get<string>('language', 'zh-cn'), vscode.env.language);

  constructor(private readonly context: vscode.ExtensionContext, private readonly onDispose: () => void) {
    for (const template of builtinProjectTemplates) { if (!adapterRegistry.projectTemplates.has(template.id)) { adapterRegistry.projectTemplates.register(template.id, template); } }
    const catalog = deviceCatalog(context);
    // STM32 devices come from the workspaces' own .ioc files; added once per extension host.
    try { catalog.add(new Stm32WorkspaceProvider(() => (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath), host)); } catch { /* already added by an earlier wizard */ }
    this.model = new WizardModel({
      favorites: new DeviceFavorites(context.globalState), recents: new RecentDevices(context.globalState), templates: new FavoriteTemplates(context.globalState),
      projectTemplates: adapterRegistry.projectTemplates, snapshot: () => catalog.snapshot(), loaded: () => this.loaded,
      creation: () => ({ tools: this.tools, fs: { exists: p => fs.stat(p).then(() => true, () => false), isDirectory: p => fs.stat(p).then(s => s.isDirectory(), () => false) }, isStm32Project: async f => !!await stm32Backend.detect(f, host), remote: !!vscode.env.remoteName }),
      language: this.language()
    }, this.initialState());
    this.panel = vscode.window.createWebviewPanel('sakuraAtelier.newProject', wizardText(this.language(), 'New project'), vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')], retainContextWhenHidden: false });
    this.panel.onDidDispose(() => { this.disposed = true; if (!this.completed) { void this.saveDraft().catch(error => { void vscode.window.showWarningMessage(`Sakura Atelier: Could not save project draft: ${String(error)}`); }); } this.onDispose(); });
    this.panel.webview.onDidReceiveMessage(message => { void this.handle(message); });
    this.panel.onDidChangeViewState(() => { if (this.panel.visible && !this.disposed) { void this.refreshTools().then(() => this.post()).catch(error => console.error('Sakura Atelier project SDK refresh:', error)); } });
  }

  reveal(): void { this.panel.reveal(); }

  private initialState(): unknown {
    const draft = this.context.globalState.get<unknown>(draftKey);
    const defaults = this.context.globalState.get<Defaults>(defaultsKey, {});
    defaults.parentDir ??= vscode.workspace.workspaceFolders?.find(f => f.uri.scheme === 'file')?.uri.fsPath;
    const active = vscode.window.activeTextEditor?.document.languageId;
    const language = active === 'javascript' ? 'node' : active;
    const initialTemplate = builtinProjectTemplates.find(t => t.language === language)?.id ?? 'general.python';
    return { templateId: initialTemplate, ...(draft && typeof draft === 'object' ? draft : {}), ...(typeof defaults.parentDir === 'string' && !(draft as { parentDir?: string } | undefined)?.parentDir ? { parentDir: defaults.parentDir } : {}) };
  }
  private async saveDraft(): Promise<void> { await this.context.globalState.update(draftKey, this.model.state); }

  async start(): Promise<void> {
    const nonce = randomBytes(16).toString('base64');
    this.panel.webview.html = renderWizardHtml({ nonce, cspSource: this.panel.webview.cspSource, codiconUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'codicon.css')).toString(), cssLanguage: this.language() === 'zh-cn' ? 'zh-CN' : 'en', title: wizardText(this.language(), 'New project') });
    await this.refreshTools();
    void deviceCatalog(this.context).load(false).then(() => { this.loaded = true; return this.post(); }).catch(error => { if (!this.disposed) { void vscode.window.showErrorMessage(`Sakura Atelier: Could not load devices: ${String(error)}`); } });
  }

  private async refreshTools(): Promise<void> {
    const statuses = await createToolRegistry(this.context).discover();
    const registry = hostToolchains();
    await registry?.settled();
    const runtimes: NonNullable<CreationContext['tools']['runtimes']> = {};
    for (const tool of registry?.snapshot().tools ?? []) { if (!runtimes[tool.language] && (tool.available || tool.manual) && await fs.stat(tool.executable).then(s => s.isFile(), () => false)) runtimes[tool.language] = tool.executable; }
    this.tools = { runtimes, pio: statuses.platformio.selected?.path, cubemx: statuses.stm32cubemx.selected?.path };
  }

  private async post(extra?: { notice?: string }): Promise<void> {
    if (this.disposed) { return; }
    const revision = this.clientRevision;
    const generation = ++this.viewGeneration;
    const view = await this.model.view();
    if (this.disposed || revision !== this.clientRevision || generation !== this.viewGeneration) { return; }
    await this.panel.webview.postMessage({ type: 'view', clientRevision: revision, view: { ...view, ...(extra?.notice ? { notice: extra.notice } : {}) } });
  }

  private async handle(raw: unknown): Promise<void> {
    const message = parseMessage(raw); if (!message) { return; }
    const revision = (raw as { clientRevision?: unknown }).clientRevision;
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0) {
      if (message.type !== 'ready' && revision < this.clientRevision) { return; }
      this.clientRevision = revision;
    }
    const t = (m: string, ...a: unknown[]) => wizardText(this.language(), m, ...a);
    try {
      switch (message.type) {
        case 'ready': await this.post(); return;
        case 'cancel': this.panel.dispose(); return;
        case 'selectTemplate': this.model.selectTemplate(message.id); break;
        case 'section': this.model.setSection(message.id); break;
        case 'search': this.model.setQuery(message.value); break;
        case 'framework': this.model.setFramework(message.value); await this.rememberFramework(message.value); break;
        case 'name': this.model.setName(message.value); break;
        case 'option': this.model.setOption(message.key, message.value); break;
        case 'toggleFavorite': await this.model.toggleFavorite(message.ref, message.name); break;
        case 'selectDevice': this.model.selectDevice(message.ref, message.name, this.context.globalState.get<Defaults>(defaultsKey, {}).frameworks?.[message.ref.id]); break;
        case 'toggleTemplateFavorite': if (await this.model.toggleTemplateFavorite()) { await this.post({ notice: t('Favorite configuration saved. Next time pick it under "My favorite templates".') }); return; } break;
        case 'applyFavorite': this.model.applyFavorite(message.id); break;
        case 'removeFavoriteTemplate': await new FavoriteTemplates(this.context.globalState).remove(message.id); break;
        case 'clearRecents': await new RecentDevices(this.context.globalState).clear(); break;
        case 'addManual': { const error = await this.model.addManual(message.kind, message.text); if (error) { void vscode.window.showWarningMessage(`Sakura Atelier: ${error}`); } break; }
        case 'reload': this.loaded = false; await this.post(); await deviceCatalog(this.context).load(true); await this.refreshTools(); this.loaded = true; break;
        case 'locateTools': await vscode.commands.executeCommand(builtinProjectTemplates.find(t => t.id === this.model.state.templateId)?.backend === 'general' ? 'sakuraAtelier.manageToolchains' : 'sakuraAtelier.embedded.manageTools'); await this.refreshTools(); break;
        case 'browse': {
          const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: t('Browse...'), defaultUri: this.model.state.parentDir ? vscode.Uri.file(this.model.state.parentDir) : undefined });
          if (picked?.[0]) { this.model.setParentDir(picked[0].fsPath); }
          break;
        }
        case 'create': await this.create(); return;
      }
      await this.post();
    } catch (error) { void vscode.window.showErrorMessage(`Sakura Atelier: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private async rememberFramework(framework: string): Promise<void> {
    const device = this.model.state.device; if (!device || !framework) { return; }
    const defaults = this.context.globalState.get<Defaults>(defaultsKey, {});
    await this.context.globalState.update(defaultsKey, { ...defaults, frameworks: { ...defaults.frameworks, [device.id]: framework } });
  }

  private async create(): Promise<void> {
    const s = this.model.state; const t = (m: string, ...a: unknown[]) => wizardText(this.language(), m, ...a);
    await this.refreshTools();
    const plan = await this.model.plan();
    if (plan.blockers.length || !plan.steps.length) { await this.post(); return; }
    try {
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Create project') }, () => executeCreation(plan, {
        mkdir: p => fs.mkdir(p), writeFile: (file, content) => fs.writeFile(file, content, { flag: 'wx' }), run: async (c, a, cwd) => { await nodeRunner(c, a, cwd, 120000); },
        confirm: async message => await vscode.window.showWarningMessage(message, { modal: true }, 'OK') === 'OK',
        launch: (command, args) => { const child = spawn(command, args, { detached: true, stdio: 'ignore' }); child.once('error', e => { void vscode.window.showErrorMessage(`Sakura Atelier: ${t('Could not create the project: {0}', e.message)}`); }); child.unref(); }
      }));
      await this.model.recordSuccess();
      const defaults = this.context.globalState.get<Defaults>(defaultsKey, {});
      await this.context.globalState.update(defaultsKey, { ...defaults, parentDir: s.parentDir });
      this.completed = true;
      await this.context.globalState.update(draftKey, undefined);
      for (const w of plan.warnings) { void vscode.window.showWarningMessage(`Sakura Atelier: ${t(`warning.${w.code}`)}`); }
      const open = await vscode.window.showInformationMessage(t('Created {0}.', result.target), t('Open project'));
      this.panel.dispose();
      if (open && result.open) { await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.open), { forceNewWindow: false }); }
    } catch (error) {
      // Whatever was created stays in place; nothing is deleted.
      void vscode.window.showErrorMessage(`Sakura Atelier: ${t('Could not create the project: {0}', error instanceof Error ? error.message : String(error))}`);
      await this.post();
    }
  }
}
