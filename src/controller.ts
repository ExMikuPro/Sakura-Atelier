import { t } from './i18n';
import { ui } from './ui';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AtelierConfiguration, ConfigurationFile, Selection, expand, newConfiguration } from './configuration';
import { ConfigurationStore } from './configurationStore';
import { adapters, AdapterContext } from './adapters';
import { TaskExecutor } from './executor';
import { PythonEnvironments } from './pythonEnvironments';
import { ToolchainDiscovery } from './toolchains';
import { DebugService, debuggerType } from './debugService';
import { launchConfigurations } from './launchConfigurations';
import { findProject } from './detect';
import { Mode, RunnerError, supports } from './model';
import { ManagerPanel } from './managerPanel';
import { ProjectRecord, scanProjects } from './projects';
export interface EditorContext { folder:vscode.WorkspaceFolder; root:string; file:string; language:AtelierConfiguration['language']; project:boolean }
export class AtelierController implements vscode.Disposable {
  readonly store:ConfigurationStore;readonly python=new PythonEnvironments();readonly discovery=new ToolchainDiscovery(this.python);
  readonly debug:DebugService;readonly status:vscode.StatusBarItem;
  projects:ProjectRecord[]=[];private subscriptions:vscode.Disposable[]=[];private last?:vscode.TextDocument;private panel?:ManagerPanel;
  constructor(readonly context:vscode.ExtensionContext,readonly executor:TaskExecutor,private readonly legacy:(mode?:Mode)=>Promise<void>){
    this.store=new ConfigurationStore(context);this.debug=new DebugService(()=>this.updateStatus());
    this.status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,20);this.status.command='sakuraAtelier.selectConfiguration';
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor=>{if(editor?.document.uri.scheme==='file'&&supports(editor.document.languageId)){this.last=editor.document;}this.updateStatus();}));
    if(vscode.window.activeTextEditor){this.last=vscode.window.activeTextEditor.document;}
    this.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(()=>{void this.refreshProjects();}));
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc=>{if(/(?:sakura-atelier|launch|tasks)\.json$/.test(doc.uri.path)){this.updateStatus();}}));
    void this.refreshProjects();this.updateStatus();
  }
  async refreshProjects():Promise<void>{const groups=await Promise.all((vscode.workspace.workspaceFolders??[]).map(folder=>scanProjects(folder).catch(()=>[])));this.projects=groups.flat();}
  async editorContext(folderOverride?:vscode.WorkspaceFolder):Promise<EditorContext>{
    const doc=vscode.window.activeTextEditor?.document;
    if(doc?.uri.scheme==='file'&&supports(doc.languageId)){this.last=doc;}
    const file=this.last?.uri.scheme==='file'?this.last.uri.fsPath:'';
    const folder=folderOverride??(file?vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file)):undefined)??(vscode.workspace.workspaceFolders?.length===1?vscode.workspace.workspaceFolders[0]:await vscode.window.showWorkspaceFolderPick());
    if(!folder){throw new RunnerError('Open or select a workspace folder to manage project configurations.',true);}
    const current=!!file&&vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.toString()===folder.uri.toString();
    const language=current&&this.last&&supports(this.last.languageId)?this.last.languageId:'python';
    const pioRoot=current ? await (await import('./embedded/platformio/project')).nearestPlatformioRoot(file,folder.uri.fsPath,(await import('./embedded/stm32/workflow')).stm32Host) : undefined;
    const detected=current?await findProject(file,folder.uri.fsPath,language):undefined;
    return {folder,root:pioRoot??detected?.root??folder.uri.fsPath,file:current?file:path.join(folder.uri.fsPath,'main.py'),language,project:!!pioRoot||!!detected};
  }
  updateStatus():void{void vscode.commands.executeCommand('setContext','sakuraAtelier.debugRunning',this.debug?.running??false);void this.statusText();}
  private async statusText():Promise<void>{
    try{if(!this.last||!supports(this.last.languageId)||!vscode.workspace.getWorkspaceFolder(this.last.uri)){this.status.hide();return;}const ctx=await this.editorContext();const {document}=await this.store.read(ctx.folder);const selection=this.store.selection(ctx.folder,ctx.root,document);const name=selection.kind==='managed'?document.configurations.find(c=>c.id===selection.id)?.name??t('Missing configuration'):selection.kind==='launch'||selection.kind==='task'?selection.id:t(selection.kind);
      this.status.text=`${this.debug.running?'$(debug-alt)':'$(chevron-down)'} ${name}`;this.status.tooltip=`Sakura Atelier · ${ctx.folder.name}\n${t(this.python.mismatch||'Select Run / Debug Configuration')}`;this.status.show();
    }catch{this.status.text='$(warning) Sakura Atelier';this.status.tooltip=t('Configuration needs attention');this.status.show();}
  }
  async openManager(mode:'configurations'|'toolchains'|'sdk'='configurations',add=false):Promise<void>{const ctx=await this.editorContext();if(!this.panel){this.panel=new ManagerPanel(this,()=>{this.panel=undefined;});}await this.panel.show(ctx,mode,add);}
  async selectConfiguration(id?:string):Promise<void>{
    const ctx=await this.editorContext();const {document}=await this.store.read(ctx.folder);const current=this.store.selection(ctx.folder,ctx.root,document);
    if(typeof id==='string'&&id){if(id==='auto'){await this.store.select(ctx.folder,ctx.root,{kind:'auto'});}else if(document.configurations.some(c=>c.id===id)){await this.selectManaged(ctx.folder,ctx.root,id);}else{throw new RunnerError('Configuration id was not found in this project.',true);}this.updateStatus();return;}
    const items:(vscode.QuickPickItem&{selection?:Selection;action?:string})[]=[];
    const add=(label:string,selection:Selection,description:string,detail:string)=>items.push({label:`${current.kind===selection.kind&&current.id===selection.id?'$(check) ':'  '}${['managed','launch','task'].includes(selection.kind)?label:t(label)}`,description:`${ctx.folder.name} · ${description.split(' · ').map(part=>t(part)).join(' · ')}`,detail:t(detail),selection});
    add('Auto Detect',{kind:'auto'},'Run','Use the original project-first runner');add('Run Current File',{kind:'file'},`${ctx.language} · Run`,'Original single-file runner');
    if(ctx.project){add('Run Project',{kind:'project'},`${ctx.language} · Run`,'Original project runner');if(['go','rust','python','csharp'].includes(ctx.language)){add('Test Project',{kind:'test'},`${ctx.language} · Test`,'Native language test command');}}
    for(const c of document.configurations){add(c.name,{kind:'managed',id:c.id},`${c.language} · ${c.operation==='test'?'Test':'Run / Debug'}`,`${c.kind}: ${c.target}`);}
    const launch=await launchConfigurations(ctx.folder);
    for(const c of launch){if(c.name&&c.type){add(c.name,{kind:'launch',id:c.name},`${c.type} · Run / Debug`,'Existing launch.json configuration');}}
    if(vscode.workspace.isTrusted){for(const task of await vscode.tasks.fetchTasks()){if(task.definition.type!=='sakuraRunner'&&!task.isBackground&&typeof task.scope==='object'&&task.scope.uri.toString()===ctx.folder.uri.toString()){add(task.name,{kind:'task',id:task.name},'Task · Run',task.source);}}}
    items.push({label:'Edit Configurations...',action:'edit'},{label:'Add Configuration...',action:'add'},{label:'Manage Toolchains...',action:'toolchains'},{label:'SDK Manager...',action:'sdk'},{label:'Configure Run/Debug...',action:'configure'});
    const picked=await ui.showQuickPick(items,{title:'Sakura Atelier — Run / Debug Configurations',matchOnDescription:true,matchOnDetail:true});if(!picked){return;}
    if(picked.selection){if(picked.selection.kind==='managed'){await this.selectManaged(ctx.folder,ctx.root,picked.selection.id!);}else{await this.store.select(ctx.folder,ctx.root,picked.selection);}this.updateStatus();return;}
    if(picked.action==='configure'){await this.configureNative();}else{await this.openManager(picked.action==='toolchains'?'toolchains':picked.action==='sdk'?'sdk':'configurations',picked.action==='add');}
  }
  private async configureNative():Promise<void>{const choice=await ui.showQuickPick(['Edit Configurations...','Open launch.json / Add Debug Configuration','Open Tasks Configuration'],{title:'Configure Run/Debug'});if(choice?.startsWith('Edit')){await this.openManager();}else if(choice?.startsWith('Open launch')){await vscode.commands.executeCommand('workbench.action.debug.configure');}else if(choice){await vscode.commands.executeCommand('workbench.action.tasks.configureTaskRunner');}}
  async stm32(action:'build'|'run'|'debug'):Promise<void>{
    const active=vscode.window.activeTextEditor?.document.uri;
    const ctx=await this.editorContext(active?vscode.workspace.getWorkspaceFolder(active):undefined); let {document}=await this.store.read(ctx.folder);
    if(vscode.workspace.isTrusted && !document.configurations.some(c=>c.templateId==='stm32')){
      const {readStm32Project}=await import('./embedded/stm32/project');const workflow=await import('./embedded/stm32/workflow');
      for(let root=active?path.dirname(active.fsPath):ctx.root;;root=path.dirname(root)){
        if(await readStm32Project(root,workflow.stm32Host)){await workflow.seedGeneratedConfigurations(this.context,root);document=(await this.store.read(ctx.folder)).document;break;}
        if(root===ctx.folder.uri.fsPath || path.dirname(root)===root)break;
      }
    }
    const selection=this.store.selection(ctx.folder,ctx.root,document);
    const selected=selection.kind==='managed'?document.configurations.find(c=>c.id===selection.id && c.templateId==='stm32'):undefined;
    const candidates=document.configurations.filter(c=>c.templateId==='stm32' && (action==='build' ? c.stm32Action==='build' : c.stm32Action===action));
    const nearest=active?candidates.filter(c=>{const root=path.resolve(ctx.folder.uri.fsPath,c.target.replaceAll('${workspaceFolder}',ctx.folder.uri.fsPath));return active.fsPath===root || active.fsPath.startsWith(root+path.sep);}):[];
    nearest.sort((a,b)=>b.target.length-a.target.length);
    const best=(selected && (!nearest.length || selected.target===nearest[0].target)?selected:undefined) || nearest[0] || (candidates.length===1?candidates[0]:undefined);
    const c=best || (await vscode.window.showQuickPick(candidates.map(c=>({label:c.name,description:c.target,c})),{title:'选择 STM32 配置'}))?.c;
    if(!c){await this.openManager();return;}
    await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',true);
    try{await (await import('./embedded/stm32/workflow')).runStm32Configuration(this,ctx.folder,c,action);}finally{await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',this.executor.busy);}
  }
  async buildLanguageProject():Promise<void>{
    if(!vscode.workspace.isTrusted)throw new RunnerError('工作区未受信任。');
    const ctx=await this.editorContext();const {document}=await this.store.read(ctx.folder);const selection=this.store.selection(ctx.folder,ctx.root,document);
    const selected=selection.kind==='managed'?document.configurations.find(c=>c.id===selection.id):undefined;
    const c=selected && ['typescript.project','java.project'].includes(selected.templateId)?selected:document.configurations.find(c=>c.id===document.default && ['typescript.project','java.project'].includes(c.templateId));
    if(!c)throw new RunnerError('当前工程没有 TypeScript / Java 构建配置。');
    await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',true);
    try{if(!await this.executor.exclusive(async()=>{if(!await vscode.workspace.saveAll(false))throw new RunnerError('保存失败，已取消编译。');await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'编译项目'},()=>this.executeManaged({...c,operation:'build'},ctx,'run'));}))throw new RunnerError('另一个操作正在执行。');}finally{await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',this.executor.busy);}
  }
  async run(action:'run'|'debug'):Promise<void>{
    if(!vscode.workspace.isTrusted){throw new RunnerError('Code execution is disabled in an untrusted workspace. Trust it before running or debugging.');}
    // Preserve standalone Run and every original auto-detection behavior.
    if(action==='run'&&!vscode.workspace.workspaceFolders?.length){await this.legacy();return;}
    const ctx=await this.editorContext();const {document}=await this.store.read(ctx.folder);const selection=this.store.selection(ctx.folder,ctx.root,document);
    const pio=selection.kind==='managed'?document.configurations.find(c=>c.id===selection.id && c.templateId==='platformio'):undefined;
    const activePio=await (await import('./embedded/platformio/workflow')).activePlatformioRoot();
    const matchingPio=pio && (!activePio || path.resolve(ctx.folder.uri.fsPath,pio.target.replaceAll('${workspaceFolder}',ctx.folder.uri.fsPath))===activePio) ? pio : undefined;
    if(matchingPio || (activePio && ['auto','file','project','test'].includes(selection.kind))){await (await import('./embedded/platformio/workflow')).runPlatformioConfiguration(this,action==='debug'?'debug':undefined,matchingPio);return;}
    const embedded=selection.kind==='managed'?document.configurations.find(c=>c.id===selection.id && c.templateId==='stm32'):undefined;
    if(embedded){await (await import('./embedded/stm32/workflow')).runStm32Configuration(this,ctx.folder,embedded,action==='debug'?'debug':embedded.stm32Action==='build'?'build':embedded.stm32Action==='debug'?'debug':'run');return;}
    if(action==='run'&&['auto','file','project'].includes(selection.kind)){await this.legacy(selection.kind==='file'?'file':selection.kind==='project'?'project':undefined);return;}
    await this.executor.exclusive(async()=>{
      const doc=vscode.window.activeTextEditor?.document;if(doc?.isDirty&&!await doc.save()){throw new RunnerError('Save failed; execution cancelled.');}
      if(selection.kind==='task'&&action==='run'){await this.runTask(ctx.folder,selection.id!);return;}
      if(selection.kind==='launch'){await this.launchNamed(ctx,selection.id!,action==='run');return;}
      let managed=selection.kind==='managed'?document.configurations.find(c=>c.id===selection.id):undefined;
      if(selection.kind==='managed'&&!managed){throw new RunnerError('Selected configuration no longer exists. Select another configuration.',true);}
      if(!managed&&action==='debug'){
        const launch=await launchConfigurations(ctx.folder);
        if(launch.length){const picked=launch.length===1?launch[0]:await ui.showQuickPick(launch.map(c=>({label:c.name,c})),{title:'Select compatible Debug configuration'});if(picked){await this.launchNamed(ctx,'c' in picked?picked.c.name:picked.name,false);}return;}
        if(!['go','python','javascript','typescript','javascriptreact','typescriptreact'].includes(ctx.language)){throw new RunnerError('Create or choose a launch.json configuration for this language, or add an executable run configuration.',true);}
      }
      if(!managed){managed=newConfiguration(ctx.language,selection.kind==='test'?`${ctx.language}: ${t('Test Project')}`:`${ctx.language}: ${t(action)}`);managed.id='automatic';managed.cwd=ctx.root;managed.target=selection.kind==='test'?(ctx.language==='go'?'./...':'.'):ctx.file;managed.kind=selection.kind==='test'?'project':'file';if(selection.kind==='test'){managed.operation='test';}}
      await this.executeManaged(managed,ctx,action);
    });
  }
  defaultSdk(language:string,folder:vscode.WorkspaceFolder){const id=this.store.defaultToolchain(language,folder)||(['javascript','javascriptreact','typescript','typescriptreact'].includes(language)?this.store.defaultToolchain('node',folder):'');return this.store.toolchains(folder).find(t=>t.id===id);}
  async runTask(folder:vscode.WorkspaceFolder,label:unknown):Promise<void>{const match=(t:vscode.Task)=>typeof label==='string'?t.name===label:!!label&&typeof label==='object'&&Object.entries(label).every(([key,value])=>t.definition[key]===value);const matches=(await vscode.tasks.fetchTasks()).filter(t=>t.definition.type!=='sakuraRunner'&&match(t)&&(typeof t.scope!=='object'||t.scope.uri.toString()===folder.uri.toString()));if(matches.length!==1){throw new RunnerError(`Task "${label}" was not found or is ambiguous in ${folder.name}.`,true);}await this.executor.runExisting(matches[0]);}
  private async named(folder:vscode.WorkspaceFolder,name:string):Promise<vscode.DebugConfiguration>{const configs=await launchConfigurations(folder);const matches=configs.filter(c=>c.name===name);if(matches.length!==1){throw new RunnerError(`Debug configuration "${name}" is missing or ambiguous in ${folder.name}.`,true);}return {...matches[0]};}
  private async launchNamed(ctx:EditorContext,name:string,noDebug:boolean):Promise<void>{const launch=await this.named(ctx.folder,name);if(launch.preLaunchTask!==undefined){await this.runTask(ctx.folder,launch.preLaunchTask);delete launch.preLaunchTask;}await this.debug.start(ctx.folder,launch,noDebug);}
  async resolved(c:AtelierConfiguration,ctx:EditorContext,cache:string,synchronizePython=true):Promise<{configuration:AtelierConfiguration;context:AdapterContext}>{
    const local=this.store.toolchains(ctx.folder);const variables={workspace:ctx.folder.uri.fsPath,project:ctx.root,file:ctx.file,cache,env:process.env,secret:(key:string)=>this.context.secrets.get(`atelier:${ctx.folder.uri.toString()}:${key}`),localPath:(id:string)=>this.context.globalState.get<Record<string,string>>('atelier.paths',{})[ctx.folder.uri.toString()+':'+id],toolchain:(id:string)=>local.find(t=>t.id===id)?.executable};
    const result={...c,env:{...c.env}};
    for(const key of ['target','cwd','toolchain','output'] as const){result[key]=await expand(c[key],variables);}
    for(const key of ['args','buildArgs','sources','includePaths','libraryPaths','linkArgs','classPath','modulePath'] as const){result[key]=await Promise.all(c[key].map(v=>expand(v,variables)));}
    for(const [key,value] of Object.entries(c.env)){result.env[key]=await expand(value,variables);}
    const cwd=path.resolve(ctx.folder.uri.fsPath,result.cwd||ctx.root);result.cwd=cwd;
    let executable=result.toolchain;
    const reference=c.toolchain.match(/^\$\{toolchain:([^}]+)\}$/)?.[1];
    if(c.language==='rust'&&!result.rustToolchain&&reference){result.rustToolchain=local.find(t=>t.id===reference)?.rustToolchain||'';}
    if(!executable && ['typescript.project','java.project'].includes(c.templateId))executable=this.context.globalState.get<string>('atelier.createdProjectSdk:'+vscode.Uri.file(cwd).toString(),'');
    const defaultId=this.store.defaultToolchain(c.language,ctx.folder)||(['javascript','typescript','javascriptreact','typescriptreact'].includes(c.language)?this.store.defaultToolchain('node',ctx.folder):'');
    if(c.language==='rust'&&!result.rustToolchain&&defaultId){result.rustToolchain=local.find(t=>t.id===defaultId)?.rustToolchain||'';}
    if(!executable&&defaultId){executable=local.find(t=>t.id===defaultId)?.executable||'';if(!executable){throw new RunnerError('Selected default SDK no longer exists. Open Toolchains Manager.',true);}}
    const settings=vscode.workspace.getConfiguration('sakuraRunner',ctx.folder.uri);
    if(c.language==='python' && c.toolchain.endsWith('/.venv'))executable=path.join(executable,process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if(executable&&await fs.stat(path.resolve(ctx.root,executable)).then(s=>s.isDirectory()).catch(()=>false)){const names:Record<string,string[]>= {python:process.platform==='win32'?['Scripts/python.exe','python.exe']:['bin/python3','bin/python'],go:['bin/go'+(process.platform==='win32'?'.exe':'')],rust:['bin/cargo'+(process.platform==='win32'?'.exe':'')],node:process.platform==='win32'?['node.exe']:['bin/node'],c:['bin/clang','bin/gcc','bin/cl.exe'],cpp:['bin/clang++','bin/g++','bin/cl.exe'],csharp:['dotnet'+(process.platform==='win32'?'.exe':'')],java:['bin/java'+(process.platform==='win32'?'.exe':'')]};const candidates=names[c.language]||names.node;let found='';for(const relative of candidates){const candidate=path.join(executable,relative);if(await fs.stat(candidate).then(s=>s.isFile()).catch(()=>false)){found=candidate;break;}}if(!found){throw new RunnerError('No supported executable was found in this SDK directory. Select its exact executable.',true);}executable=found;}
    if(c.language==='python' && /(?:^|\/)\.venv(?:\/|$)/.test(c.toolchain) && !await fs.stat(executable).then(s=>s.isFile()).catch(()=>false))throw new RunnerError('项目 .venv 缺失或损坏。请执行“Python：重新创建项目虚拟环境”修复。');
    if(c.language==='python' && /(?:^|\/)\.venv(?:\/|$)/.test(c.toolchain)){try{await (await import('./toolchains')).query(executable,['-c','import sys; assert sys.prefix != sys.base_prefix'],cwd);}catch{throw new RunnerError('项目 .venv 不可用。请执行“Python：重新创建项目虚拟环境”修复。');}}
    if(c.language==='python'){executable=await this.python.interpreter(executable||settings.get<string>('pythonPath',''),ctx.folder,ctx.root,synchronizePython);}
    if(!executable&&c.language==='c'){executable=settings.get('cCompiler','');}if(!executable&&c.language==='cpp'){executable=settings.get('cppCompiler','');}
    if(!executable&&c.language==='java'){executable=settings.get('javaPath','')||(process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'');}
    let projectRoot=cwd;const language=c.language==='node'?'javascript':c.language;
    if(supports(language)&&['file','executable'].includes(c.kind)){const target=path.resolve(cwd,result.target||ctx.file);const project=await findProject(target,ctx.folder.uri.fsPath,language);if(project){projectRoot=project.root;}}
    const context:AdapterContext={folder:ctx.folder,root:projectRoot,file:ctx.file,cache,environment:result.env,toolchain:executable};
    context.environment=adapters.get(c.language)!.resolveTerminalEnvironment(result,context);return {configuration:result,context};
  }
  private async executeManaged(input:AtelierConfiguration,ctx:EditorContext,action:'run'|'debug'):Promise<void>{
    const cache=await fs.mkdtemp(path.join(os.tmpdir(),'sakura-atelier-'));let keep=false;
    const cleanup=()=>fs.rm(cache,{recursive:true,force:true});
    try{
      const {configuration:c,context}=await this.resolved(input,ctx,cache);const adapter=adapters.get(c.language)!;adapter.validateConfiguration(c);
      if(c.preLaunchTask){await this.runTask(ctx.folder,c.preLaunchTask);}
      if(c.kind==='task'){if(action==='run'){await this.runTask(ctx.folder,c.target);return;}if(c.debugName){await this.launchNamed(ctx,c.debugName,false);return;}if(!c.debugName){throw new RunnerError('This task has no corresponding Debug Configuration. Select a launch.json entry.',true);}}
      if(c.kind==='launch'){await this.launchNamed(ctx,c.target,action==='run');return;}
      if(action==='run'){const prepared=await adapter.buildRunPlan(c,context);await this.executor.run(prepared.plan,ctx.folder);return;}
      if(c.debugName&&(['csharp','java'].includes(c.language)||c.script)){const launch=await this.named(ctx.folder,c.debugName);if(launch.preLaunchTask!==undefined&&launch.preLaunchTask!==c.preLaunchTask){await this.runTask(ctx.folder,launch.preLaunchTask);}delete launch.preLaunchTask;await this.debug.start(ctx.folder,{...launch,cwd:c.cwd,args:c.args,env:context.environment});return;}
      const type=c.debugName?(await this.named(ctx.folder,c.debugName)).type:debuggerType(c.language,c.debugType);
      const prepared=await adapter.buildDebugPlan(c,context,type);
      if(prepared.build.length){await this.executor.run({name:`Build ${c.name}`,steps:prepared.build},ctx.folder);}
      if(prepared.artifactFile){const artifacts=JSON.parse(await fs.readFile(prepared.artifactFile,'utf8')) as {executable:string;name:string}[];if(!artifacts.length){throw new RunnerError('Cargo did not produce a runnable executable.',true);}const picked=artifacts.length===1?artifacts[0]:await ui.showQuickPick(artifacts.map(a=>({label:a.name,artifact:a})),{title:'Select Cargo executable'});if(!picked){return;}prepared.configuration.program='artifact' in picked?picked.artifact.executable:picked.executable;}
      let launch=prepared.configuration;
      if(c.debugName){const existing=await this.named(ctx.folder,c.debugName);if(existing.preLaunchTask!==undefined&&existing.preLaunchTask!==c.preLaunchTask){await this.runTask(ctx.folder,existing.preLaunchTask);}delete existing.preLaunchTask;launch={...existing,...launch,name:existing.name};}
      await this.debug.start(ctx.folder,launch,false,cleanup);keep=true;
    }finally{if(!keep){await cleanup();}this.updateStatus();}
  }
  async checkDependencies(id?:string):Promise<void>{const {inspectProjectDependencies}=await import('./environment/dependencyUi');await inspectProjectDependencies(this,id);}
  async createPythonTerminal():Promise<void>{const ctx=await this.editorContext();const {document}=await this.store.read(ctx.folder);const selected=this.store.selection(ctx.folder,ctx.root,document);const c=selected.kind==='managed'?document.configurations.find(c=>c.id===selected.id):newConfiguration('python');if(!c||c.language!=='python'){throw new RunnerError('Select a Python run configuration before opening its terminal.',true);}const cache=await fs.mkdtemp(path.join(os.tmpdir(),'sakura-atelier-terminal-'));try{const resolved=await this.resolved(c,ctx,cache);await this.python.createTerminal(resolved.context.toolchain,ctx.folder,resolved.configuration.cwd,c.autoActivate);}finally{await fs.rm(cache,{recursive:true,force:true});}}
  pioMonitor?:TaskExecutor;
  pioMonitorRoot?:string;
  stm32Cleanup?:()=>Promise<void>;
  async stop():Promise<void>{this.executor.stop();this.pioMonitor?.stop();await this.debug.stop();await this.stm32Cleanup?.();this.stm32Cleanup=undefined;}
  dispose():void{this.pioMonitor?.dispose();void this.stm32Cleanup?.();this.panel?.dispose();this.python.dispose();this.debug.dispose();this.status.dispose();for(const sub of this.subscriptions){sub.dispose();}}
  async selectManaged(folder:vscode.WorkspaceFolder,root:string,id:string):Promise<void>{await this.store.select(folder,root,{kind:'managed',id});void import('./embedded/stm32/intellisense').then(service=>service.refreshStm32IntelliSense(this)).catch(error=>console.error('STM32 代码补全刷新：',error));const c=(await this.store.read(folder)).document.configurations.find(c=>c.id===id);if(c?.language==='python'&&c.toolchain){const ctx=await this.editorContext(folder);const cache=await fs.mkdtemp(path.join(os.tmpdir(),'sakura-atelier-select-'));try{await this.resolved(c,{...ctx,root},cache);}finally{await fs.rm(cache,{recursive:true,force:true});}}this.updateStatus();}
  async document(folder:vscode.WorkspaceFolder):Promise<ConfigurationFile>{return (await this.store.read(folder)).document;}
}
