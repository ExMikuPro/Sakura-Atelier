import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { query, toolchainId } from './toolchains';
import { randomBytes } from 'node:crypto';
import { launchConfigurations } from './launchConfigurations';
import type { AtelierController, EditorContext } from './controller';
import { LocalToolchain, RuntimeLanguage, runtimeLanguages, validateFile } from './configuration';
import { SdkManager } from './sdkManager';
import { PackageSummary } from './packageManagers';
import { RunnerError } from './model';
export class ManagerPanel implements vscode.Disposable {
  readonly panel:vscode.WebviewPanel;private editor?:EditorContext;private subscriptions:vscode.Disposable[]=[];private sdk:SdkManager;
  private discovered=new Map<string,LocalToolchain>();private busy=false;private ready=false;private initializing=false;private mode='configurations';private pendingAdd=false;
  constructor(private readonly controller:AtelierController,closed:()=>void){
    const root=vscode.Uri.joinPath(controller.context.extensionUri,'media');
    this.panel=vscode.window.createWebviewPanel('sakuraAtelier.configurations','Sakura Atelier — Run / Debug Configurations',vscode.ViewColumn.One,{enableScripts:true,localResourceRoots:[root],retainContextWhenHidden:true});
    this.sdk=new SdkManager(async(details)=>{await this.discoverAll();if(details?.installedPath){await this.discoverPrefix(details.installedPath);}await this.sendTools();});
    const nonce=randomBytes(24).toString('base64');const uri=(name:string)=>this.panel.webview.asWebviewUri(vscode.Uri.joinPath(root,name));
    this.panel.webview.html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; font-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';"><link href="${uri('codicon.css')}" rel="stylesheet"><link href="${uri('manager.css')}" rel="stylesheet"></head><body><div id="app"></div><script nonce="${nonce}" src="${uri('manager.js')}"></script></body></html>`;
    this.subscriptions.push(this.panel.onDidDispose(()=>{this.sdk.dispose();for(const sub of this.subscriptions){sub.dispose();}closed();}));
    this.subscriptions.push(this.panel.webview.onDidReceiveMessage(message=>{void this.message(message).catch(error=>this.error(error));}));
  }
  async show(editor:EditorContext,mode:string,add:boolean):Promise<void>{const same=this.editor?.folder.uri.toString()===editor.folder.uri.toString()&&this.editor?.root===editor.root;this.editor=editor;this.mode=mode;this.pendingAdd=add;this.panel.reveal();this.initializing=true;try{await this.sdk.detect(editor.folder.uri.fsPath);}finally{this.initializing=false;}if(this.ready){if(same){await this.panel.webview.postMessage({type:'mode',mode,add,sdkStatus:this.sdk.status,file:editor.file,language:editor.language});this.pendingAdd=false;}else{await this.sendState();}}}
  private error(error:unknown):void{void this.panel.webview.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
  private async sendState(mode?:string,add=false):Promise<void>{
    if(!this.editor){return;}const {document,revision}=await this.controller.store.read(this.editor.folder);
    const tools=this.controller.store.toolchains(this.editor.folder);for(const tool of tools){this.discovered.set(tool.id,tool);}
    await this.panel.webview.postMessage({type:'state',document,revision,mode:mode??this.mode,add:add||this.pendingAdd,folder:this.editor.folder.uri.toString(),root:this.editor.root,file:this.editor.file,language:this.editor.language,workspaces:(vscode.workspace.workspaceFolders??[]).map(f=>({name:f.name,uri:f.uri.toString()})),projects:this.controller.projects.map(p=>({root:p.root,marker:p.marker,languages:p.languages,folder:p.folder.uri.toString()})),toolchains:tools,launch:await launchConfigurations(this.editor.folder),sdkStatus:this.sdk.status,sdkHelp:this.sdk.helpUrl,pythonStatus:this.controller.python.mismatch,terminalActivation:{modern:vscode.workspace.getConfiguration('python-envs',this.editor.folder.uri).get('terminal.autoActivationType','unavailable'),legacy:vscode.workspace.getConfiguration('python',this.editor.folder.uri).get('terminal.activateEnvironment',true)}});this.pendingAdd=false;
  }
  private async discoverPrefix(prefix:string):Promise<void>{
    if(!this.editor){return;}const directory=await fs.realpath(prefix);const bin=path.join(directory,'bin');const files=await fs.readdir(bin,{withFileTypes:true}).catch(()=>[]);const found:LocalToolchain[]=[];
    for(const file of files){const name=file.name;let language:RuntimeLanguage|undefined;if(name==='go')language='go';else if(name==='cargo')language='rust';else if(/^python(?:3(?:\.\d+)?)?$/.test(name))language='python';else if(name==='node')language='node';else if(/^(clang|gcc(?:-\d+)?)$/.test(name))language='c';else if(/^(clang\+\+|g\+\+(?:-\d+)?)$/.test(name))language='cpp';else if(name==='dotnet')language='csharp';else if(name==='java')language='java';if(!language){continue;}const executable=path.join(bin,name);const canonical=await fs.realpath(executable).catch(()=>executable);if(language==='rust'&&path.basename(canonical).startsWith('rustup')){continue;}try{const version=(await query(executable,language==='go'?['version']:['--version'],this.editor.folder.uri.fsPath,{...process.env,GOTOOLCHAIN:'local'})).split(/\r?\n/)[0];found.push({id:toolchainId(language,executable),name:`${name} ${version}`,language,executable,version,manager:'Installed package SDK',project:this.editor.folder.uri.toString()});}catch{/* An unavailable executable can still be located manually. */}}
    const existing=this.controller.store.toolchains(this.editor.folder);const map=new Map([...existing,...found].map(t=>[t.id,t]));await this.controller.store.putToolchains([...map.values()],this.editor.folder);for(const tool of found){this.discovered.set(tool.id,tool);}
  }
  private async sendTools():Promise<void>{if(this.editor){await this.panel.webview.postMessage({type:'toolsRefreshed',tools:this.controller.store.toolchains(this.editor.folder),sdkStatus:this.sdk.status});}}
  private async discoverAll():Promise<LocalToolchain[]>{
    if(!this.editor){return [];}const discovered=(await Promise.all((['go','rust','python','node','c','cpp','csharp','java'] as RuntimeLanguage[]).map(language=>this.controller.discovery.discover(language,this.editor!.folder)))).flat();
    const previous=this.controller.store.toolchains(this.editor.folder);const map=new Map([...previous,...discovered].map(t=>[t.id,t]));await this.controller.store.putToolchains([...map.values()],this.editor.folder);for(const t of discovered){this.discovered.set(t.id,t);}return discovered;
  }
  private async message(value:unknown):Promise<void>{
    if(!value||typeof value!=='object'||Array.isArray(value)){throw new RunnerError('Invalid configuration editor message.');}
    const m=value as Record<string,unknown>;if(typeof m.type!=='string'){return;}if(!this.editor){return;}
    const editor=this.editor;
    if(m.type==='ready'||m.type==='reload'){this.ready=true;if(!this.initializing){await this.sendState();}return;}
    if(m.type==='workspace'){
      const folder=vscode.workspace.workspaceFolders?.find(f=>f.uri.toString()===m.folder);if(!folder){throw new RunnerError('Workspace folder is no longer open.');}
      this.editor=await this.controller.editorContext(folder);await this.sdk.detect(folder.uri.fsPath);await this.sendState();return;
    }
    if(m.type==='project'){
      const project=this.controller.projects.find(p=>p.root===m.root&&p.folder.uri.toString()===editor.folder.uri.toString());if(!project){throw new RunnerError('Choose a detected project inside this workspace.');}this.editor={...editor,root:project.root,project:true,language:project.languages[0]??editor.language};await this.sendState();return;
    }
    if(m.type==='cancel'){this.panel.dispose();return;}
    if(m.type==='save'){
      if(this.busy){throw new RunnerError('Another configuration operation is in progress.');}this.busy=true;
      try{if(typeof m.revision!=='string'){throw new RunnerError('Missing editor revision.');}validateFile(m.document);if((await this.controller.store.read(editor.folder)).revision!==m.revision){throw new RunnerError('Configuration changed on disk. Reload before saving.');}if(m.toolchains!==undefined){await this.controller.store.putToolchains(m.toolchains as LocalToolchain[],editor.folder);}const saved=await this.controller.store.save(editor.folder,m.document,m.revision);if(typeof m.selected==='string'&&saved.document.configurations.some(c=>c.id===m.selected)){await this.controller.selectManaged(editor.folder,editor.root,m.selected);}await this.panel.webview.postMessage({type:'saved',...saved});this.controller.updateStatus();if(m.close===true){this.panel.dispose();}}finally{this.busy=false;}return;
    }
    if(m.type==='browse'){
      if(!['target','cwd','toolchain','output','tcPath'].includes(String(m.field))){throw new RunnerError('Invalid file picker field.');}
      const uri=m.field==='output'?await vscode.window.showSaveDialog({title:'Select executable / output path'}):(await vscode.window.showOpenDialog({title:'Locate existing file or SDK',canSelectFiles:m.directory!==true,canSelectFolders:m.directory===true,canSelectMany:false}))?.[0];
      if(uri){await this.panel.webview.postMessage({type:'browsed',field:m.field,path:uri.fsPath});}return;
    }
    if(m.type==='discover'){
      const language=m.language as RuntimeLanguage;if(!(runtimeLanguages as readonly unknown[]).includes(language)){throw new RunnerError('Choose a supported language.');}
      const tools=await this.controller.discovery.discover(language,editor.folder);for(const tool of tools){this.discovered.set(tool.id,tool);}await this.panel.webview.postMessage({type:'discovered',tools,language});return;
    }
    if(m.type==='pythonSelect'){
      const tool=this.discovered.get(String(m.id));if(!tool||tool.language!=='python'){throw new RunnerError('Discover or save this Python interpreter first.');}await this.controller.python.synchronize(tool.executable,editor.folder.uri);await this.panel.webview.postMessage({type:'pythonStatus',message:this.controller.python.mismatch||'Synchronized with the official Python environment selection.'});return;
    }
    if(m.type==='createVenv'){
      if(!vscode.workspace.isTrusted){throw new RunnerError('Trust the workspace before creating an environment.');}
      const modern=await this.controller.python.modern();
      if(modern?.createEnvironment){await modern.createEnvironment(editor.folder.uri,{quickCreate:false});}
      else {const tool=this.discovered.get(String(m.id));if(!tool||tool.language!=='python'){throw new RunnerError('Select a discovered Python interpreter first.');}const name=await vscode.window.showInputBox({title:'Create virtual environment in this workspace',value:'.venv',validateInput:v=>/^[a-zA-Z0-9_. -]+$/.test(v)&&v!=='.'&&v!=='..'?undefined:'Use one new directory name.'});if(!name){return;}const target=path.join(editor.folder.uri.fsPath,name);if(await fs.stat(target).then(()=>true).catch(()=>false)){throw new RunnerError('That directory already exists; it will not be overwritten.');}await this.controller.executor.exclusive(()=>this.controller.executor.run({name:'Create Python venv',steps:[{command:tool.executable,args:['-m','venv',target],cwd:editor.folder.uri.fsPath,label:'Create Python environment'}]},editor.folder));}
      const tools=await this.controller.discovery.discover('python',editor.folder);for(const tool of tools){this.discovered.set(tool.id,tool);}await this.panel.webview.postMessage({type:'discovered',tools,language:'python'});return;
    }
    if(m.type==='terminal'){await this.controller.createPythonTerminal();return;}
    if(m.type==='defaultSdk'){
      const tool=this.discovered.get(String(m.id));if(!tool){throw new RunnerError('Discover or save this SDK first.');}const existing=this.controller.store.toolchains(editor.folder).filter(t=>t.id!==tool.id);await this.controller.store.putToolchains([...existing,{...tool,project:m.global===true?'':tool.project}],editor.folder);await this.controller.store.setDefaultToolchain(tool.language,tool.id,editor.folder,m.global===true);await this.panel.webview.postMessage({type:'notice',message:`${tool.name} is now the ${m.global===true?'Sakura Atelier global':'workspace'} default. System defaults were not changed.`});return;
    }
    if(m.type==='secret'){
      const name=await vscode.window.showInputBox({title:'Secret reference name',prompt:'Stored locally in VS Code SecretStorage, never in the project file.',validateInput:value=>/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(value)?undefined:'Use letters, digits, dots, underscores and hyphens.'});if(!name){return;}const secret=await vscode.window.showInputBox({title:`Store ${name}`,password:true,ignoreFocusOut:true});if(secret===undefined){return;}await this.controller.context.secrets.store(`atelier:${editor.folder.uri.toString()}:${name}`,secret);await this.panel.webview.postMessage({type:'notice',message:`Saved secret reference: \${secret:${name}}`});return;
    }
    if(m.type==='nativeDebug'){await vscode.commands.executeCommand('workbench.action.debug.configure');return;}
    if(m.type==='sdkHelp'){if(this.sdk.helpUrl){await vscode.env.openExternal(vscode.Uri.parse(this.sdk.helpUrl));}return;}
    if(m.type==='sdkList'){
      if(!['search','installed','updates'].includes(String(m.mode))||typeof m.keyword!=='string'){throw new RunnerError('Invalid SDK query.');}const packages=await this.sdk.list(m.mode as 'search'|'installed'|'updates',m.keyword);await this.panel.webview.postMessage({type:'sdkPackages',packages});return;
    }
    if(m.type==='sdkDetails'){const details=await this.sdk.details(m.item as PackageSummary);await this.panel.webview.postMessage({type:'sdkDetails',details});return;}
    if(m.type==='sdkInstall'){if(typeof m.key!=='string'||typeof m.version!=='string'){throw new RunnerError('Invalid install request.');}const result=await this.sdk.install(m.key,m.version,editor.folder.uri.fsPath);await this.panel.webview.postMessage({type:'notice',message:result.cancelled?'Installation cancelled.':'Installation completed. Toolchains were refreshed; your selected SDK was not changed.'});return;}
    if(m.type==='refreshTools'){await this.discoverAll();await this.sendTools();return;}
    throw new RunnerError('Unsupported editor operation.');
  }
  dispose():void{this.panel.dispose();}
}
