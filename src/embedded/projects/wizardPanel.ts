import {resolveTool} from '../../tools';
import {installJavaTool} from '../../languageProjects/javaTools';
import {initializeLanguageProject} from '../../languageProjects/initialize';
import {initializationRunner} from '../../languageProjects/process';
import {initializrMetadata,InitializrMetadata,supportsBoot} from '../../languageProjects/springInitializr';
import type {ProjectSdk} from '../../languageProjects/options';
import { hostToolchains } from '../../environment/registryAccess';
import type { CreationContext } from './creation';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { generateWithCubeMx, requireClassicCubeMx, cancelCubeMxGenerations } from '../stm32/cubeMxCli';
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
import { ensureArduinoEntry } from '../platformio/arduino';
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
  private creating = false;
  private readonly output: vscode.OutputChannel;
  private sdks:ProjectSdk[]=[];
  private spring?:InitializrMetadata;
  private springLoading=false;
  private creationAbort?:AbortController;
  private tools: CreationContext['tools'] = {};
  private readonly language = () => resolveUiLanguage(vscode.workspace.getConfiguration('sakuraAtelier').get<string>('language', 'zh-cn'), vscode.env.language);

  constructor(private readonly context: vscode.ExtensionContext, private readonly onDispose: () => void) {
    this.output = vscode.window.createOutputChannel('Sakura Atelier — 项目初始化');
    context.subscriptions.push(this.output);
    context.subscriptions.push({ dispose: cancelCubeMxGenerations },{dispose:()=>this.creationAbort?.abort()});
    for (const template of builtinProjectTemplates) { if (!adapterRegistry.projectTemplates.has(template.id)) { adapterRegistry.projectTemplates.register(template.id, template); } }
    const catalog = deviceCatalog(context);
    // STM32 devices come from the workspaces' own .ioc files; added once per extension host.
    try { catalog.add(new Stm32WorkspaceProvider(() => (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath), host)); } catch { /* already added by an earlier wizard */ }
    this.model = new WizardModel({
      favorites: new DeviceFavorites(context.globalState), recents: new RecentDevices(context.globalState), templates: new FavoriteTemplates(context.globalState),
      projectTemplates: adapterRegistry.projectTemplates, snapshot: () => catalog.snapshot(), loaded: () => this.loaded,
      creation: () => ({ tools: this.tools, sdkChoices:this.sdks, fs: { exists: p => fs.stat(p).then(() => true, () => false), isDirectory: p => fs.stat(p).then(s => s.isDirectory(), () => false) }, isStm32Project: async f => !!await stm32Backend.detect(f, host), remote: !!vscode.env.remoteName }),
      language: this.language()
    }, this.initialState());
    this.panel = vscode.window.createWebviewPanel('sakuraAtelier.newProject', wizardText(this.language(), 'New project'), vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')], retainContextWhenHidden: false });
    this.panel.onDidDispose(() => { this.disposed = true; this.creationAbort?.abort(); if (!this.completed) { void this.saveDraft().catch(error => { void vscode.window.showWarningMessage(`Sakura Atelier: Could not save project draft: ${String(error)}`); }); } this.onDispose(); });
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
    if(this.model.state.options.javaFramework==='spring-boot')await this.loadSpring().catch(error=>{void vscode.window.showErrorMessage('Spring Initializr 元数据读取失败：'+String(error));});
    void deviceCatalog(this.context).load(false).then(() => { this.loaded = true; return this.post(); }).catch(error => { if (!this.disposed) { void vscode.window.showErrorMessage(`Sakura Atelier: Could not load devices: ${String(error)}`); } });
  }

  private async refreshTools(): Promise<void> {
    const statuses = await createToolRegistry(this.context).discover();
    const registry = hostToolchains();
    await registry?.settled();
    const runtimes: NonNullable<CreationContext['tools']['runtimes']> = {};
    for (const tool of registry?.snapshot().tools ?? []) { if (!runtimes[tool.language] && (tool.available || tool.manual) && await fs.stat(tool.executable).then(s => s.isFile(), () => false)) runtimes[tool.language] = tool.executable; }
    this.sdks=(registry?.snapshot().tools ?? []).filter(t=>(t.available||t.manual)&&['python','node','java'].includes(t.language)).map(t=>({id:t.id,name:t.name,version:t.version,language:t.language,executable:t.executable}));
    const locate=async(name:string)=>resolveTool(name,this.model.state.parentDir || process.cwd()).catch(()=>undefined);
    const [uv,npm,pnpm,maven,gradle]=await Promise.all(['uv','npm','pnpm','mvn','gradle'].map(locate));
    const installed=this.context.globalState.get<Record<string,string>>('atelier.java.buildTools',{});
    const local=async(value:string|undefined)=>value && await fs.stat(value).then(s=>s.isFile()).catch(()=>false)?value:undefined;
    this.tools = { runtimes,uv,npm,pnpm,maven:maven || await local(installed.maven),gradle:gradle || await local(installed.gradle), pio: statuses.platformio.selected?.path, cubemx: statuses.stm32cubemx.selected?.path, cmake: statuses.cmake.selected?.path, armGcc: statuses['arm-gcc'].selected?.path, ninja: statuses.ninja.selected?.path };
  }

  private async loadSpring():Promise<void>{
    if(this.spring || this.springLoading)return;
    this.springLoading=true;await this.post({notice:'正在读取官方 Spring Initializr 元数据…'});
    try{
      this.spring=await initializrMetadata();
      if(this.model.state.templateId==='general.java' && this.model.state.options.javaFramework==='spring-boot' && !this.model.state.options.frameworkVersion && this.spring.defaultBoot)this.model.setOption('frameworkVersion',this.spring.defaultBoot);
      if(this.model.state.templateId==='general.java' && this.model.state.options.javaFramework==='spring-boot' && !this.model.state.options.javaVersion && this.spring.defaultJava)this.model.setOption('javaVersion',this.spring.defaultJava);
    }finally{this.springLoading=false;}
  }

  private async post(extra?: { notice?: string }): Promise<void> {
    if (this.disposed) { return; }
    const revision = this.clientRevision;
    const generation = ++this.viewGeneration;
    const view = await this.model.view();
    if (this.disposed || revision !== this.clientRevision || generation !== this.viewGeneration) { return; }
    await this.panel.webview.postMessage({ type: 'view', clientRevision: revision, view: { ...view, spring:this.spring ? {...this.spring,dependencies:this.spring.dependencies.filter(d=>supportsBoot(d.versionRange,this.model.state.options.frameworkVersion || this.spring!.bootVersions[0]?.id || ''))} : undefined,springLoading:this.springLoading, canCreate: view.canCreate && !this.creating && !(this.model.state.options.javaFramework==='spring-boot'&&!this.spring), ...(extra?.notice ? { notice: extra.notice } : {}) } });
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
        case 'option': this.model.setOption(message.key, message.value);
          if(message.key==='javaFramework' && message.value==='spring-boot')await this.loadSpring();
          break;
        case 'toggleFavorite': await this.model.toggleFavorite(message.ref, message.name); break;
        case 'selectDevice': this.model.selectDevice(message.ref, message.name, this.context.globalState.get<Defaults>(defaultsKey, {}).frameworks?.[message.ref.id]); break;
        case 'toggleTemplateFavorite': if (await this.model.toggleTemplateFavorite()) { await this.post({ notice: t('Favorite configuration saved. Next time pick it under "My favorite templates".') }); return; } break;
        case 'applyFavorite': this.model.applyFavorite(message.id); break;
        case 'removeFavoriteTemplate': await new FavoriteTemplates(this.context.globalState).remove(message.id); break;
        case 'clearRecents': await new RecentDevices(this.context.globalState).clear(); break;
        case 'addManual': { const error = await this.model.addManual(message.kind, message.text); if (error) { void vscode.window.showWarningMessage(`Sakura Atelier: ${error}`); } break; }
        case 'reload': this.loaded = false; await this.post(); await deviceCatalog(this.context).load(true); await this.refreshTools(); this.loaded = true; break;
        case 'configureJavaTools': await vscode.commands.executeCommand('sakuraAtelier.java.configureBuildTools',this.model.state.options.javaBuild?.startsWith('gradle')?'gradle':'maven');await this.refreshTools();break;
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
    if (this.creating || this.disposed) return;
    this.creating = true;
    try { await this.post(); await this.createProject(); }
    finally { this.creating = false; await this.post(); }
  }

  private async createProject(): Promise<void> {
    if(!vscode.workspace.isTrusted){throw new Error('工作区未受信任，不能创建虚拟环境或初始化依赖。');}
    const s = this.model.state; const t = (m: string, ...a: unknown[]) => wizardText(this.language(), m, ...a);
    await this.refreshTools();
    const plan = await this.model.plan();
    if (plan.blockers.length || !plan.steps.length) { await this.post(); return; }
    for (const step of plan.steps) { if (step.kind === 'generate-cubemx') await requireClassicCubeMx(step.job.executable); }
    try {
      this.creationAbort=new AbortController();
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('Create project'), cancellable: true }, (progress, cancellation) => {
        const abort=this.creationAbort!;const listener=cancellation.onCancellationRequested(()=>abort.abort());
        const report=(message:string)=>progress.report({message});
        const run=initializationRunner(text=>{this.output.append(text);},abort.signal,report);
        return executeCreation(plan, {
        cancelled:()=>abort.signal.aborted || !vscode.workspace.isTrusted,
        initializeProject:async request=>{this.output.show(true);await this.context.globalState.update('atelier.createdProjectSdk:'+vscode.Uri.file(request.root).toString(),request.sdk);if(request.language==='java' && request.options.javaFramework!=='spring-boot'){const tool=request.options.javaBuild?.startsWith('gradle')?'gradle':'maven';if(!request.tools[tool]){const executable=await installJavaTool(vscode.Uri.joinPath(this.context.globalStorageUri,'java-tools').fsPath,tool,report,abort.signal);request.tools[tool]=executable;await this.context.globalState.update('atelier.java.buildTools',{...this.context.globalState.get('atelier.java.buildTools',{}),[tool]:executable});}}await initializeLanguageProject(request,run,report,abort.signal);},
        ensureArduinoEntry, mkdir: p => fs.mkdir(p), writeFile: (file, content) => fs.writeFile(file, content, { flag: 'wx' }), run: async (c, a, cwd) => { await nodeRunner(c, a, cwd, 120000); },
        generateCubeMx: job => { this.output.show(true); return generateWithCubeMx(job, text => this.output.append(text), cancellation); }
      }).finally(()=>listener.dispose());});
      if(plan.steps.some(step=>step.kind==='generate-cubemx')) {
        await (await import('../stm32/workflow')).seedGeneratedConfigurations(this.context,result.target,true);
      }
      await this.model.recordSuccess();
      const defaults = this.context.globalState.get<Defaults>(defaultsKey, {});
      await this.context.globalState.update(defaultsKey, { ...defaults, parentDir: s.parentDir });
      this.completed = true;
      await this.context.globalState.update(draftKey, undefined);
      for (const w of plan.warnings) { void vscode.window.showWarningMessage(`Sakura Atelier: ${t(`warning.${w.code}`)}`); }
      const initialization=plan.steps.find(step=>step.kind==='initialize');
      const completed=initialization?.kind==='initialize' ? `工程文件和依赖初始化已完成，${initialization.request.options.javaFramework==='spring-boot'?'构建':'默认入口'}验证通过：${result.target}` : t('Created {0}.', result.target);
      const open = await vscode.window.showInformationMessage(completed, t('Open project'));
      this.panel.dispose();
      if (open && result.open) { await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.open), { forceNewWindow: false }); }
    } catch (error) {
      // Whatever was created stays in place; nothing is deleted.
      void vscode.window.showErrorMessage(`Sakura Atelier: ${t('Could not create the project: {0}', error instanceof Error ? error.message : String(error))}`);
      await this.post();
    }
  }
}
