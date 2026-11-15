import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AtelierController } from '../../controller';
import { PlatformioCompletionLoader } from '../platformio/intellisense';
import { nodeRunner } from '../process';
import { nearestPlatformioRoot } from '../platformio/project';
import { createToolRegistry } from '../toolsCommand';
import { readStm32Project } from './project';
import { buildDirectory } from './plans';
import { stm32Host } from './workflow';
import { compileConfiguration, cubeMxConfiguration, nearestConfiguration, CompileEntry, SourceConfiguration } from './intellisenseModel';

const instances=new WeakMap<AtelierController,Stm32IntelliSense>();
export async function refreshStm32IntelliSense(controller:AtelierController,resetCompiler=false):Promise<void>{await instances.get(controller)?.update(resetCompiler);}
const providerId='ExMikuPro.sakura-atelier';
interface CppApi extends vscode.Disposable {
  registerCustomConfigurationProvider(provider: Stm32IntelliSense): void;
  notifyReady(provider: Stm32IntelliSense): void;
  didChangeCustomConfiguration(provider: Stm32IntelliSense): void;
  didChangeCustomBrowseConfiguration(provider: Stm32IntelliSense): void;
}
interface ProjectConfiguration {root:string;folder:vscode.WorkspaceFolder;fallback:SourceConfiguration;entries:{file:string;configuration:SourceConfiguration}[]; cFallback?:SourceConfiguration}

/** A cpptools provider, not a language server. Paths are supplied in memory, never saved in shared settings. */
export class Stm32IntelliSense implements vscode.Disposable {
  readonly name='Sakura Atelier · STM32 / PlatformIO';
  readonly extensionId=providerId;
  private api?:CppApi;
  private projects:ProjectConfiguration[]=[];
  private disposed=false;
  private subscriptions:vscode.Disposable[]=[];
  private timer?:ReturnType<typeof setTimeout>;
  private refreshing?:Promise<void>;
  private rerun=false;
  private pioLoader=new PlatformioCompletionLoader();
  private compiler?:Promise<string|undefined>;
  constructor(private readonly controller:AtelierController) {
    instances.set(controller,this);
    const watcher=vscode.workspace.createFileSystemWatcher('**/{platformio.ini,idedata.json,*.ioc,*.cmake,CMakeLists.txt,CMakePresets.json,Makefile,compile_commands.json,c_cpp_properties.json,sakura-atelier.json}');
    const schedule=()=>this.schedule();
    this.subscriptions.push(watcher,watcher.onDidCreate(schedule),watcher.onDidChange(schedule),watcher.onDidDelete(schedule),vscode.workspace.onDidChangeWorkspaceFolders(schedule),vscode.workspace.onDidGrantWorkspaceTrust(schedule),vscode.extensions.onDidChange(schedule),vscode.window.onDidChangeActiveTextEditor?.(schedule) ?? {dispose(){}},vscode.workspace.onDidChangeConfiguration(event=>{
      if(event.affectsConfiguration('sakuraAtelier.stm32.autoIntelliSense')||event.affectsConfiguration('sakuraAtelier.platformio.autoIntelliSense')||event.affectsConfiguration('C_Cpp'))this.schedule();
    }));
    this.schedule();
  }
  private schedule():void {if(this.disposed)return;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.refresh().catch(error=>console.error('STM32 代码补全配置：',error));},300);}
  async update(resetCompiler=false):Promise<void>{if(resetCompiler){this.compiler=undefined;this.pioLoader.reset();}await this.refresh();}
  async refresh():Promise<void> {
    if(this.refreshing){this.rerun=true;return this.refreshing;}
    this.refreshing=(async()=>{do{this.rerun=false;await this.scan();}while(this.rerun&&!this.disposed);})();
    try{await this.refreshing;}finally{this.refreshing=undefined;}
  }
  private async scan():Promise<void> {
    if(this.disposed||!vscode.workspace.isTrusted){this.projects=[];return;}
    const next:ProjectConfiguration[]=[];
    for(const folder of vscode.workspace.workspaceFolders??[]) {
      if(folder.uri.scheme!=='file')continue;
      const settings=vscode.workspace.getConfiguration('sakuraAtelier.stm32',folder.uri);
      if(vscode.workspace.getConfiguration('sakuraAtelier.platformio',folder.uri).get('autoIntelliSense',true)) {
        const markers=await vscode.workspace.findFiles(new vscode.RelativePattern(folder,'**/platformio.ini'),'**/{node_modules,.git,build,.pio}/**',500);
        const pioRoots=[...new Set(markers.filter(uri=>path.basename(uri.fsPath)==='platformio.ini').map(uri=>path.dirname(uri.fsPath)))];
        if(pioRoots.length) {
          const pio=await createToolRegistry(this.controller.context).resolve('platformio');
          const stored=await this.controller.store.read(folder);
          const active=vscode.window.activeTextEditor?.document.uri;
          const selectedProvider=vscode.workspace.getConfiguration('C_Cpp',folder.uri).get<string>('default.configurationProvider');
          const ownsCompletion=!selectedProvider || selectedProvider.toLowerCase()===providerId.toLowerCase();
          const activeRoot=active?.scheme==='file' ? await nearestPlatformioRoot(active.fsPath,folder.uri.fsPath,stm32Host) : undefined;
          for(const root of pioRoots) {
            const configured=stored.document.configurations.find(c=>c.templateId==='platformio' && c.pioEnvironment && path.resolve(folder.uri.fsPath,c.target.replaceAll('${workspaceFolder}',folder.uri.fsPath))===root)?.pioEnvironment;
            const remembered=configured || this.controller.context.workspaceState.get<string>(`sakuraAtelier.pio.env:${root}`);
            if(!pio)continue;
            try {
              const completion=await this.pioLoader.load(root,pio,nodeRunner,remembered,activeRoot===root && ownsCompletion);
              if(completion) next.push({root,folder,entries:[],fallback:completion.cpp,cFallback:completion.c});
            } catch {
              const key='atelier.pio.intellisense.failed:'+root;
              if(activeRoot===root && !this.controller.context.workspaceState.get(key)) {
                await this.controller.context.workspaceState.update(key,true);
                const action=await vscode.window.showWarningMessage('PlatformIO 代码补全准备失败。请检查 Core、网络和 SDK 安装，编译后可点击“刷新 PlatformIO 代码补全”重试。','刷新 PlatformIO 代码补全');
                if(action) void vscode.commands.executeCommand('sakuraAtelier.embedded.platformio.refreshIntelliSense');
              }
            }
          }
        }
      }
      if(!settings.get('autoIntelliSense',true)) {if(!next.some(p=>p.folder===folder))await this.restoreDefault(folder);continue;}
      const markers=await vscode.workspace.findFiles(new vscode.RelativePattern(folder,'**/{*.ioc,CMakeLists.txt}'),'**/{node_modules,.git,build,.pio,Drivers}/**',500);
      const roots=[...new Set(markers.map(uri=>path.dirname(uri.fsPath)))];
      const stored=await this.controller.store.read(folder);
      for(const root of roots) {
        const project=await readStm32Project(root,stm32Host);if(!project)continue;
        // Compiler discovery is machine-local. No build, generation or flashing occurs here.
        this.compiler ??= createToolRegistry(this.controller.context).resolve('arm-gcc');
        let compiler=await this.compiler;
        const selection=this.controller.store.selection(folder,root,stored.document);
        const config=stored.document.configurations.find(c=>c.id===selection.id && c.templateId==='stm32' && path.resolve(folder.uri.fsPath,c.target.replaceAll('${workspaceFolder}',folder.uri.fsPath))===root);
        if(config?.stm32Gcc) {
          const ref=config.stm32Gcc.match(/^\$\{localPath:([^}]+)\}$/)?.[1];
          const configured=ref?this.controller.context.globalState.get<Record<string,string>>('atelier.paths',{})[folder.uri.toString()+':'+ref]:config.stm32Gcc.replaceAll('${workspaceFolder}',folder.uri.fsPath).replaceAll('${projectDir}',root);
          if(configured && await fs.stat(configured).then(s=>s.isFile()).catch(()=>false))compiler=configured;
        }
        const profile=config?.profile==='release'?'Release':'Debug';
        const preset=config?.stm32Preset || project.presets.find(p=>/debug/i.test(project.presetBuildTypes?.[p]||p)) || project.presets[0];
        const directories=[buildDirectory(project,profile,preset),path.join(root,'build',profile),path.join(root,'build'),root];
        let entries:ProjectConfiguration['entries']=[];
        for(const directory of [...new Set(directories)]) {
          try {
            const raw:unknown=JSON.parse(await fs.readFile(path.join(directory,'compile_commands.json'),'utf8'));
            if(!Array.isArray(raw))continue;
            entries=raw.slice(0,20000).flatMap((value:CompileEntry)=>{
              if(!value||typeof value.file!=='string'||typeof value.directory!=='string'||(!Array.isArray(value.arguments)&&typeof value.command!=='string'))return [];
              if(value.arguments?.some(a=>typeof a!=='string'))return [];
              const entry={...value,directory:path.resolve(directory,value.directory)};
              const file=path.resolve(entry.directory,entry.file);
              if(!inside(root,file))return [];
              try{return [{file,configuration:compileConfiguration(entry,compiler)}];}catch{return [];}
            });
            if(entries.length)break;
          } catch { /* A missing/in-progress database falls back to read-only CubeMX metadata. */ }
        }
        next.push({root,folder,entries,fallback:await cubeMxConfiguration(project,stm32Host,compiler,profile==='Release')});
      }
    }
    if(this.disposed||!vscode.workspace.isTrusted)return;
    this.projects=next.sort((a,b)=>b.root.length-a.root.length);
    for(const folder of vscode.workspace.workspaceFolders??[])if(!next.some(p=>p.folder.uri.toString()===folder.uri.toString()))await this.restoreDefault(folder);
    if(!this.projects.length){this.api?.didChangeCustomConfiguration(this);this.api?.didChangeCustomBrowseConfiguration(this);return;}
    if(!this.api) {
      const extension=vscode.extensions.getExtension<{getApi(version:number):CppApi}>('ms-vscode.cpptools');
      if(!extension) {
        const key='atelier.stm32.intellisense.missing';
        if(!this.controller.context.workspaceState.get(key)){
          await this.controller.context.workspaceState.update(key,true);
          const action=await vscode.window.showInformationMessage('STM32 / PlatformIO 代码补全需要 Microsoft C/C++ 扩展。','安装 C/C++');
          if(action)await vscode.commands.executeCommand('workbench.extensions.installExtension','ms-vscode.cpptools');
        }
        return;
      }
      const exports=extension.isActive?extension.exports:await extension.activate();
      if(this.disposed||!vscode.workspace.isTrusted)return;
      this.api=exports.getApi(6);
      this.api.registerCustomConfigurationProvider(this);
      this.api.notifyReady(this);
    }
    for(const folder of vscode.workspace.workspaceFolders??[]) {
      if(!next.some(project=>project.folder.uri.toString()===folder.uri.toString()))continue;
      const settings=vscode.workspace.getConfiguration('C_Cpp',folder.uri);
      // Respect explicit providers/databases and existing manually maintained configurations.
      if(settings.get<string>('default.configurationProvider') && settings.get<string>('default.configurationProvider')?.toLowerCase()!==providerId.toLowerCase())continue;
      const database=settings.get<string|string[]>('default.compileCommands');
      if(typeof database==='string'?!!database:Array.isArray(database)&&database.some(value=>!!value.trim()))continue;
      if(['default.includePath','default.defines','default.compilerPath'].some(key=>{const value=settings.inspect(key);return value && (value.workspaceFolderValue!==undefined||value.workspaceValue!==undefined||value.globalValue!==undefined);}))continue;
      if(await fs.stat(path.join(folder.uri.fsPath,'.vscode/c_cpp_properties.json')).then(s=>s.isFile()).catch(()=>false))continue;
      if(!settings.get('default.configurationProvider')) {
        await settings.update('default.configurationProvider',providerId,vscode.ConfigurationTarget.WorkspaceFolder);
        await this.controller.context.workspaceState.update('atelier.stm32.intellisense.owner:'+folder.uri.toString(),true);
      }
    }
    this.api.didChangeCustomConfiguration(this);
    this.api.didChangeCustomBrowseConfiguration(this);
  }
  private async restoreDefault(folder:vscode.WorkspaceFolder):Promise<void> {
    const key='atelier.stm32.intellisense.owner:'+folder.uri.toString();
    const settings=vscode.workspace.getConfiguration('C_Cpp',folder.uri);
    if(this.controller.context.workspaceState.get(key) && settings.get<string>('default.configurationProvider')?.toLowerCase()===providerId.toLowerCase()) {
      await settings.update('default.configurationProvider',undefined,vscode.ConfigurationTarget.WorkspaceFolder);
      await this.controller.context.workspaceState.update(key,undefined);
    }
  }
  private project(uri:vscode.Uri):ProjectConfiguration|undefined {return !this.disposed&&vscode.workspace.isTrusted&&uri.scheme==='file'?this.projects.find(p=>inside(p.root,uri.fsPath)):undefined;}
  async canProvideConfiguration(uri:vscode.Uri):Promise<boolean> {return !!this.project(uri);}
  async provideConfigurations(uris:vscode.Uri[],token?:vscode.CancellationToken):Promise<{uri:vscode.Uri;configuration:SourceConfiguration}[]> {
    return uris.flatMap(uri=>{if(token?.isCancellationRequested)return [];const project=this.project(uri);return project?[{uri,configuration:project.cFallback ? (/\.c$/i.test(uri.fsPath) ? project.cFallback : project.fallback) : nearestConfiguration(uri.fsPath,project.entries,project.fallback)}]:[];});
  }
  async canProvideBrowseConfiguration():Promise<boolean>{return false;}
  async provideBrowseConfiguration():Promise<null>{return null;}
  async canProvideBrowseConfigurationsPerFolder():Promise<boolean>{return true;}
  async provideFolderBrowseConfiguration(uri:vscode.Uri):Promise<{browsePath:string[];compilerPath?:string}|null>{
    if(!vscode.workspace.isTrusted||this.disposed)return null;
    const projects=this.projects.filter(p=>p.folder.uri.toString()===uri.toString());
    return projects.length?{browsePath:[...new Set(projects.flatMap(p=>[p.root,...p.fallback.includePath,...p.entries.flatMap(e=>e.configuration.includePath)]))],compilerPath:projects[0].fallback.compilerPath}:null;
  }
  dispose():void {if(this.disposed)return;this.disposed=true;if(this.timer)clearTimeout(this.timer);for(const item of this.subscriptions)item.dispose();this.api?.dispose();this.projects=[];instances.delete(this.controller);}
}
function inside(root:string,file:string):boolean {const relative=path.relative(root,file);return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));}
