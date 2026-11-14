import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findProject } from './detect';
import { createPlans } from './planner';
import { Mode, RunnerError, Settings, supports, relevantTaskType } from './model';
import { TaskExecutor } from './executor';
import { AtelierController } from './controller';
let executor: TaskExecutor | undefined;
let controller: AtelierController | undefined;
export function activate(context: vscode.ExtensionContext): void {
  executor = new TaskExecutor();
  controller = new AtelierController(context,executor,mode=>run(mode,()=>controller!.openManager()));
  context.subscriptions.push(executor,controller);
  const safe = (work:()=>Promise<unknown>) => async () => {
    try { return await work(); }
    catch(error){ if(error instanceof RunnerError&&error.message==='Run stopped.'){return;}console.error('Sakura Atelier:',error);void vscode.window.showErrorMessage(`Sakura Atelier: ${error instanceof Error?error.message:String(error)}`,'Edit Configurations...').then(action=>{if(action){void controller?.openManager();}}); }
  };
  const action = (kind:'run'|'debug',mode?:Mode) => safe(async()=>{
    if(!vscode.workspace.isTrusted){await vscode.window.showWarningMessage('Sakura Atelier: Code execution is disabled in an untrusted workspace. Trust this workspace before running.');return;}
    await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',true);
    try{if(mode){await run(mode,()=>controller!.openManager());}else{await controller!.run(kind);}}
    finally{await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',executor?.busy??false);}
  });
  for(const namespace of ['sakuraAtelier','sakuraRunner']){
    const register=(name:string,handler:(...args:never[])=>unknown)=>context.subscriptions.push(vscode.commands.registerCommand(`${namespace}.${name}`,handler));
    register('run',action('run'));register('runFile',action('run','file'));register('runProject',action('run','project'));register('debug',action('debug'));
    register('stop',safe(()=>controller!.stop()));register('configure',safe(()=>controller!.openManager()));register('editConfigurations',safe(()=>controller!.openManager()));register('addConfiguration',safe(()=>controller!.openManager('configurations',true)));register('manageToolchains',safe(()=>controller!.openManager('toolchains')));register('sdkManager',safe(()=>controller!.openManager('sdk')));register('pythonTerminal',safe(()=>controller!.createPythonTerminal()));
    context.subscriptions.push(vscode.commands.registerCommand(`${namespace}.selectConfiguration`,(id?:string)=>safe(()=>controller!.selectConfiguration(id))()));
  }
  if(vscode.extensions.getExtension('sakura-runner-local.sakura-runner')){void vscode.window.showInformationMessage('Sakura Atelier has a new extension ID. Disable the old Sakura Runner extension to avoid duplicate toolbar buttons.');}
}
async function run(mode: Mode | undefined, configure: () => Thenable<unknown>): Promise<void> {
  if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Sakura Atelier: Code execution is disabled in an untrusted workspace. Trust this workspace before running.'); return; }
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
          const choice=choices.length===1?choices[0]:await vscode.window.showQuickPick(choices,{title:'Select run task'});
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
        const picked = plans.length === 1 ? plans[0] : (await vscode.window.showQuickPick(plans.map((plan, i) => ({ label: plan.name, i })), { title: 'Sakura Atelier: Select run target' }));
        if (picked) { const selected='i' in picked ? plans[picked.i] : picked; if(sdk&&!legacyCustom){for(const step of selected.steps){step.env={...step.env,[process.platform==='win32'?'Path':'PATH']:[path.dirname(sdk.executable),process.env.PATH||''].join(path.delimiter),...(sdk.rustToolchain?{RUSTUP_TOOLCHAIN:sdk.rustToolchain}:{})};if(document.languageId==='go'&&step.command==='go'||document.languageId==='rust'&&step.command==='cargo'||document.languageId==='csharp'&&step.command==='dotnet'||['javascript','javascriptreact','typescript','typescriptreact'].includes(document.languageId)&&/^node(?:\.exe)?$/.test(path.basename(step.command))){step.command=sdk.executable;}}}await executor!.run(selected, folder); }
      } finally { await fs.rm(cache, { recursive: true, force: true }); }
    });
  } catch (error) {
    if (error instanceof RunnerError && error.message === 'Run stopped.') { return; }
    console.error('Sakura Atelier legacy Run:',error);
    const text = `Sakura Atelier: ${error instanceof Error ? error.message : String(error)}`;
    if (error instanceof RunnerError && error.configure) {
      void vscode.window.showErrorMessage(text, 'Configure Runner').then(action => { if (action === 'Configure Runner') { void configure(); } });
    } else { void vscode.window.showErrorMessage(text); }
  }
}
export async function deactivate(): Promise<void> { try{await controller?.stop();}finally{controller?.dispose();controller=undefined;await executor?.shutdown();executor=undefined;} }
