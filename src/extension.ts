import { startHostToolchains } from './environment/hostServices';
import { language } from './i18n';
import { ui } from './ui';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findProject } from './detect';
import { createPlans } from './planner';
import { Mode, RunnerError, Settings, supports, relevantTaskType } from './model';
import { TaskExecutor } from './executor';
import { AtelierController } from './controller';
import { initializeEmbeddedState, registerEmbeddedEditors } from './embedded/editors';
let executor: TaskExecutor | undefined;
let controller: AtelierController | undefined;
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(startHostToolchains(context));
  executor = new TaskExecutor();
  controller = new AtelierController(context,executor,mode=>run(mode,()=>controller!.openManager()));
  context.subscriptions.push(executor,controller);
  const safe = (work:()=>Promise<unknown>) => async () => {
    try { return await work(); }
    catch(error){ if(error instanceof RunnerError&&error.message==='Run stopped.'){return;}console.error('Sakura Atelier:',error);void ui.showErrorMessage(`Sakura Atelier: ${error instanceof Error?error.message:String(error)}`,'Edit Configurations...').then(action=>{if(action){void controller?.openManager();}}); }
  };
  const action = (kind:'run'|'debug',mode?:Mode) => safe(async()=>{
    if(!vscode.workspace.isTrusted){await ui.showWarningMessage('Sakura Atelier: Code execution is disabled in an untrusted workspace. Trust this workspace before running.');return;}
    await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',true);
    try{if(mode && await (await import('./embedded/platformio/workflow')).activePlatformioRoot()){await (await import('./embedded/platformio/workflow')).runPlatformioConfiguration(controller!);}else if(mode){await run(mode,()=>controller!.openManager());}else{await controller!.run(kind);}}
    finally{await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',executor?.busy??false);}
  });
  for(const namespace of ['sakuraAtelier','sakuraRunner']){
    const register=(name:string,handler:(...args:never[])=>unknown)=>context.subscriptions.push(vscode.commands.registerCommand(`${namespace}.${name}`,handler));
    register('run',action('run'));register('runFile',action('run','file'));register('runProject',action('run','project'));register('debug',action('debug'));
    register('stop',safe(()=>controller!.stop()));register('configure',safe(()=>controller!.openManager()));register('editConfigurations',safe(()=>controller!.openManager()));register('addConfiguration',safe(()=>controller!.openManager('configurations',true)));register('manageToolchains',safe(()=>controller!.openManager('toolchains')));register('sdkManager',safe(()=>controller!.openManager('sdk')));register('pythonTerminal',safe(()=>controller!.createPythonTerminal()));
    context.subscriptions.push(vscode.commands.registerCommand(`${namespace}.selectConfiguration`,(id?:string)=>safe(()=>controller!.selectConfiguration(id))()));
  }
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.java.configureBuildTools',(preferred?:'maven'|'gradle')=>safe(async()=>{await (await import('./languageProjects/configureJavaTools')).configureJavaTools(controller!,preferred);})()));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.python.recreateEnvironment',safe(async()=>{await (await import('./languageProjects/pythonRepair')).repairProjectVenv(controller!);})));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.build',safe(()=>controller!.buildLanguageProject())));
  const updateLanguageBuildContext=async()=>{
    let enabled=false;const doc=vscode.window.activeTextEditor?.document;
    if(doc && ['java','typescript','typescriptreact'].includes(doc.languageId)){const folder=vscode.workspace.getWorkspaceFolder(doc.uri);if(folder){const data=await controller!.store.read(folder);enabled=data.document.configurations.some(c=>['typescript.project','java.project'].includes(c.templateId));}}
    if(vscode.window.activeTextEditor?.document.uri.toString()===doc?.uri.toString())await vscode.commands.executeCommand('setContext','sakuraAtelier.languageProjectBuild',enabled);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(()=>{void updateLanguageBuildContext();}));void updateLanguageBuildContext();
  try { initializeEmbeddedState(context); registerEmbeddedEditors(context); } catch (error) { console.error('Sakura Atelier: embedded editors are unavailable.', error); }
  // Embedded support is loaded on first use so activation stays unchanged.
  for(const name of ['manageTools','platformio.selectEnvironment','platformio.build','platformio.clean','platformio.upload','platformio.debug','platformio.monitor','platformio.test','platformio.testOnDevice','stm32.build','stm32.flash','stm32.debug','reloadDevices','newProject'] as const){
    context.subscriptions.push(vscode.commands.registerCommand(name==='newProject'?'sakuraAtelier.newProject':`sakuraAtelier.embedded.${name}`,safe(async()=>{if(name.startsWith('platformio.')){await (await import('./embedded/platformio/workflow')).runPlatformioConfiguration(controller!,name.slice('platformio.'.length) as import('./embedded/platformio/plans').PlatformioOperation|'selectEnvironment');return;}if(name==='stm32.build'||name==='stm32.flash'||name==='stm32.debug'){await controller!.stm32(name==='stm32.build'?'build':name==='stm32.flash'?'run':'debug');return;}const embedded=await import('./embedded/commands');await embedded.runEmbeddedCommand(name,context,executor!,controller!.debug);if(name==='manageTools')await (await import('./embedded/stm32/intellisense')).refreshStm32IntelliSense(controller!,true);})));
  }
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.embedded.stm32.run',safe(()=>controller!.stm32('run'))));
  let scanningStm32=false;
  const scanStm32=safe(async()=>{if(scanningStm32)return;scanningStm32=true;try{await (await import('./embedded/platformio/workflow')).refreshPlatformioConfigurations(controller!);await (await import('./embedded/stm32/workflow')).offerStm32Configurations(controller!);}finally{scanningStm32=false;}});
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.embedded.stm32.refreshConfigurations',(root?:string)=>safe(async()=>{await (await import('./embedded/stm32/workflow')).offerStm32Configurations(controller!,root);})()));
  let scanTimer:ReturnType<typeof setTimeout>|undefined;
  const watcher=vscode.workspace.createFileSystemWatcher('**/{platformio.ini,*.ioc,CMakeLists.txt,CMakePresets.json}');
  const scheduleScan=()=>{if(scanTimer)clearTimeout(scanTimer);scanTimer=setTimeout(()=>{void scanStm32();void updateStm32Context();},800);};
  context.subscriptions.push(watcher,watcher.onDidCreate(scheduleScan),watcher.onDidChange(scheduleScan),watcher.onDidDelete(scheduleScan),vscode.workspace.onDidChangeWorkspaceFolders(scheduleScan),vscode.workspace.onDidGrantWorkspaceTrust(scheduleScan),{dispose:()=>{if(scanTimer)clearTimeout(scanTimer);}});
  const updateStm32Context=async()=>{
    const uri=vscode.window.activeTextEditor?.document.uri;
    const folder=uri?vscode.workspace.getWorkspaceFolder(uri):undefined;
    const pioRoot=await (await import('./embedded/platformio/workflow')).activePlatformioRoot();
    if(controller?.pioMonitorRoot && ((uri && controller.pioMonitorRoot!==pioRoot) || !vscode.workspace.getWorkspaceFolder(vscode.Uri.file(controller.pioMonitorRoot))))controller.pioMonitor?.stop();
    if(vscode.window.activeTextEditor?.document.uri.toString()===uri?.toString())await vscode.commands.executeCommand('setContext','sakuraAtelier.platformioEditor',!!pioRoot);
    let found=false;
    if(!pioRoot&&uri?.scheme==='file'&&folder&&(/\.(c|cpp|h|hpp|s|ioc)$/i.test(uri.fsPath)||/CMake(Lists\.txt|Presets\.json)$|Makefile$/.test(uri.fsPath))){
      const {readStm32Project}=await import('./embedded/stm32/project'); const {stm32Host}=await import('./embedded/stm32/workflow');
      for(let dir=path.dirname(uri.fsPath);;dir=path.dirname(dir)){if(await readStm32Project(dir,stm32Host)){found=true;break;}if(dir===folder.uri.fsPath||path.dirname(dir)===dir)break;}
    }
    if(vscode.window.activeTextEditor?.document.uri.toString()===uri?.toString())await vscode.commands.executeCommand('setContext','sakuraAtelier.stm32Editor',found);
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(()=>{void updateStm32Context();}));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.embedded.platformio.refreshIntelliSense',safe(async()=>{await (await import('./embedded/stm32/intellisense')).refreshStm32IntelliSense(controller!,true);})));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.embedded.platformio.refreshConfigurations',safe(async()=>{await (await import('./embedded/platformio/workflow')).refreshPlatformioConfigurations(controller!);})));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.embedded.platformio.stopMonitor',()=>controller?.pioMonitor?.stop()));
  scheduleScan();void updateStm32Context();
  void import('./embedded/stm32/intellisense').then(({Stm32IntelliSense})=>{context.subscriptions.push(new Stm32IntelliSense(controller!));}).catch(error=>console.error('STM32 代码补全初始化失败：',error));
  context.subscriptions.push(vscode.commands.registerCommand('sakuraAtelier.checkProjectDependencies',safe(()=>controller!.checkDependencies())));
  for (const [name, action] of [['generate', 'generate'], ['configureCLI', 'interactive']] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(`sakuraAtelier.embedded.stm32.${name}`, (uri?: vscode.Uri) => safe(async () => {
      const { cubeMxAction } = await import('./embedded/stm32/cubeMxActions');
      await cubeMxAction(context, action, uri);
    })()));
  }
  const updateLanguage=()=>{void vscode.commands.executeCommand('setContext','sakuraAtelier.uiEnglish',language()==='en');controller?.updateStatus();};
  updateLanguage();context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('sakuraAtelier.language'))updateLanguage();}));
  for(const name of ['run','debug','selectConfiguration','stop','runFile','runProject','configure','editConfigurations','addConfiguration','manageToolchains','sdkManager','pythonTerminal']){context.subscriptions.push(vscode.commands.registerCommand(`sakuraAtelier.english.${name}`,(...args:unknown[])=>vscode.commands.executeCommand(`sakuraAtelier.${name}`,...args)));}
  if(vscode.extensions.getExtension('sakura-runner-local.sakura-runner')){void ui.showInformationMessage('Sakura Atelier has a new extension ID. Disable the old Sakura Runner extension to avoid duplicate toolbar buttons.');}


}
async function run(mode: Mode | undefined, configure: () => Thenable<unknown>): Promise<void> {
  if (!vscode.workspace.isTrusted) { await ui.showWarningMessage('Sakura Atelier: Code execution is disabled in an untrusted workspace. Trust this workspace before running.'); return; }
  if (!executor) { return; }
  try {
    await executor.exclusive(async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || document.uri.scheme !== 'file' || !supports(document.languageId)) { throw new RunnerError('Open a supported code file to run.'); }
      if (document.isDirty && !await document.save()) { throw new RunnerError('File could not be saved; run cancelled.'); }
      const file = document.uri.fsPath;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      const config = vscode.workspace.getConfiguration('sakuraRunner', document.uri);
      const selectedMode = mode ?? config.get<Mode>('defaultMode', 'auto');
      const project = await findProject(file, folder?.uri.fsPath, document.languageId);
      const settings: Settings = {
        javaPath: config.get('javaPath', ''), script: config.get('script', ''), pythonPath: config.get('pythonPath', ''),
        cCompiler: config.get('cCompiler', ''), cppCompiler: config.get('cppCompiler', ''), configurations: config.get('configurations', [])
      };
      const sdk=folder?controller?.defaultSdk(document.languageId,folder):undefined;
      const legacyCustom=settings.configurations.some(c=>c.language===document.languageId);
      if(sdk&&!legacyCustom){if(document.languageId==='python'&&!settings.pythonPath){settings.pythonPath=sdk.executable;await controller?.python.synchronize(sdk.executable,folder!.uri);}if(document.languageId==='c'&&!settings.cCompiler){settings.cCompiler=sdk.executable;}if(document.languageId==='cpp'&&!settings.cppCompiler){settings.cppCompiler=sdk.executable;}if(document.languageId==='java'&&!settings.javaPath){settings.javaPath=sdk.executable;}}
      // Explicit project tasks also support workspaces without a standard marker.
      const taskLabel = selectedMode === 'file' ? '' : config.get<string>('projectTask', '');
      const discoverTasks = project && ['java', 'c', 'cpp'].includes(document.languageId) && !settings.configurations.some(entry => entry.language === document.languageId);
      if (taskLabel || discoverTasks) {
        const matches = (await vscode.tasks.fetchTasks()).filter(task =>
          (taskLabel ? task.name === taskLabel : !task.isBackground && relevantTaskType(document.languageId, task.definition.type) && /\b(run|start|dev)\b|bootRun/i.test(task.name)) &&
          task.source !== 'Sakura Runner' && task.source !== 'Sakura Atelier' && task.definition.type !== 'sakuraRunner' &&
          (typeof task.scope !== 'object' || task.scope.uri.toString() === folder?.uri.toString()));
        if (taskLabel && !matches.length) { throw new RunnerError(`Configured task "${taskLabel}" was not found in this workspace folder.`, true); }
        if (matches.length) {
          const choices=matches.map(task=>({label:task.name,description:task.source,task}));
          const choice=choices.length===1?choices[0]:await ui.showQuickPick(choices,{title:'Select run task'});
          if(choice){await executor!.runExisting(choice.task);}
          return;
        }
      }
      if (document.languageId === 'python' && !settings.pythonPath) {
        // Use the official Python extension's public environment API, if installed.
        const python = vscode.extensions.getExtension<{ environments?: { getActiveEnvironmentPath(uri?: vscode.Uri): { path: string }; resolveEnvironment(env: { path: string }): Promise<{ executable?: { uri?: vscode.Uri } } | undefined> } }>('ms-python.python');
        if (python) {
          const api = await python.activate();
          const active = api.environments?.getActiveEnvironmentPath(document.uri);
          if (active?.path) {
            const resolved = await api.environments?.resolveEnvironment(active);
            settings.pythonPath = resolved?.executable?.uri?.fsPath ?? '';
          }
        }
      }
      const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'sakura-runner-'));
      try {
        const plans = await createPlans({ file, language: document.languageId, mode: selectedMode, project, workspace: folder?.uri.fsPath, cache, settings });
        if (!plans.length) { throw new RunnerError('No runnable targets found. Add an explicit run configuration.', true); }
        const picked = plans.length === 1 ? plans[0] : (await ui.showQuickPick(plans.map((plan, i) => ({ label: plan.name, i })), { title: 'Sakura Atelier: Select run target' }));
        if (picked) { const selected='i' in picked ? plans[picked.i] : picked; if(sdk&&!legacyCustom){for(const step of selected.steps){step.env={...step.env,[process.platform==='win32'?'Path':'PATH']:[path.dirname(sdk.executable),process.env.PATH||''].join(path.delimiter),...(sdk.rustToolchain?{RUSTUP_TOOLCHAIN:sdk.rustToolchain}:{})};if(document.languageId==='go'&&step.command==='go'||document.languageId==='rust'&&step.command==='cargo'||document.languageId==='csharp'&&step.command==='dotnet'||['javascript','javascriptreact','typescript','typescriptreact'].includes(document.languageId)&&/^node(?:\.exe)?$/.test(path.basename(step.command))){step.command=sdk.executable;}}}await executor!.run(selected, folder); }
      } finally { await fs.rm(cache, { recursive: true, force: true }); }
    });
  } catch (error) {
    if (error instanceof RunnerError && error.message === 'Run stopped.') { return; }
    console.error('Sakura Atelier legacy Run:',error);
    const text = `Sakura Atelier: ${error instanceof Error ? error.message : String(error)}`;
    if (error instanceof RunnerError && error.configure) {
      void ui.showErrorMessage(text, 'Configure Runner').then(action => { if (action === 'Configure Runner') { void configure(); } });
    } else { void ui.showErrorMessage(text); }
  }
}
export async function deactivate(): Promise<void> { try{await controller?.stop();}finally{controller?.dispose();controller=undefined;await executor?.shutdown();executor=undefined;} }
