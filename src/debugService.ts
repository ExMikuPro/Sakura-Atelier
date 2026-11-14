import { hostToolchains } from './environment/registryAccess';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { RuntimeLanguage } from './configuration';
import { RunnerError } from './model';
export const debuggerExtensions: Record<string,string> = { go:'golang.go',python:'ms-python.debugpy',rust:'vadimcn.vscode-lldb',c:'ms-vscode.cpptools',cpp:'ms-vscode.cpptools',csharp:'ms-dotnettools.csharp',java:'vscjava.vscode-java-debug',javascript:'ms-vscode.js-debug',javascriptreact:'ms-vscode.js-debug',typescript:'ms-vscode.js-debug',typescriptreact:'ms-vscode.js-debug',node:'ms-vscode.js-debug' };
export function registeredDebuggers(): Map<string,string> {
  const types=new Map<string,string>();
  for(const extension of vscode.extensions.all){if(hostToolchains()?.guard.environment.kind!=='local'&&hostToolchains()&&extension.extensionKind!==vscode.ExtensionKind.Workspace){continue;}const debuggers=extension.packageJSON?.contributes?.debuggers as {type?:string}[]|undefined;for(const entry of debuggers??[]){if(entry.type){types.set(entry.type,extension.id);}}}
  return types;
}
export function debuggerType(language: RuntimeLanguage, preferred=''): string {
  const available=registeredDebuggers();
  const candidates: string[]=preferred?[preferred]:language==='python'?['debugpy','python']:language==='go'?['go']:language==='rust'?['lldb']:['c','cpp'].includes(language)?process.platform==='win32'?['cppvsdbg','lldb','cppdbg']:['lldb','cppdbg']:language==='csharp'?['coreclr','dotnet']:language==='java'?['java']:['pwa-node','node'];
  const type=candidates.find(t=>available.has(t));
  if(!type){throw new RunnerError(`No ${language} debug adapter is installed/enabled. Install ${debuggerExtensions[language]} from Extensions, then create or select a compatible launch configuration.`,true);}
  return type;
}
/** Session ownership is tagged before startup; unrelated sessions are never stopped. */
export class DebugService implements vscode.Disposable {
  private readonly host=hostToolchains()?.guard;private readonly stopForHost=()=>{void this.stop().catch(error=>console.error('Sakura Atelier 远程调试停止：',error));};
  private owned=new Map<string,vscode.DebugSession>();
  private tokens=new Map<string,(()=>Promise<void>)|undefined>();
  private subscriptions:vscode.Disposable[]=[];
  private launching=false;
  private ownerToken=new Map<string,string>();
  private abandoned=new Set<string>();
  private cancelStart?:()=>void;
  constructor(private readonly changed:()=>void=()=>{}){this.host?.signal.addEventListener('abort',this.stopForHost,{once:true});
    this.subscriptions.push(vscode.debug.onDidStartDebugSession(session=>{
      const token=(session.configuration.__sakuraAtelierToken as string|undefined)||(session.parentSession?this.ownerToken.get(session.parentSession.id):undefined);
      if(token&&this.abandoned.has(token)){void vscode.debug.stopDebugging(session);return;}
      if(token&&this.tokens.has(token)){this.owned.set(session.id,session);this.ownerToken.set(session.id,token);this.changed();}
    }));
    this.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session=>{
      if(!this.owned.delete(session.id)){return;}
      const token=this.ownerToken.get(session.id);this.ownerToken.delete(session.id);
      if(token&&![...this.ownerToken.values()].includes(token)){
        const cleanup=this.tokens.get(token);this.tokens.delete(token);if(cleanup){void cleanup().catch(error=>console.error('Sakura Atelier debug cleanup:',error));}
      }
      this.changed();
    }));
  }
  get running():boolean{return this.owned.size>0||this.launching;}
  get sessions():readonly vscode.DebugSession[]{return [...this.owned.values()];}
  async start(folder:vscode.WorkspaceFolder,configuration:vscode.DebugConfiguration,noDebug=false,cleanup?:()=>Promise<void>):Promise<void>{
    this.host?.assert();
    if(!vscode.workspace.isTrusted){throw new RunnerError('Trust this workspace before debugging.');}
    if(this.running){throw new RunnerError('A Sakura Atelier debug session is already starting or running. Stop it before starting another.');}
    if(!registeredDebuggers().has(configuration.type)){throw new RunnerError(`目标环境 ${this.host?.environment.label??'当前扩展宿主'} 缺少调试适配器 "${configuration.type}"。请在该环境安装或启用对应调试扩展，不会回退到本机。`,true);}
    const token=randomUUID();this.tokens.set(token,cleanup);this.launching=true;this.changed();
    try{
      let timer:ReturnType<typeof setTimeout>|undefined;
      const cancelled=new Promise<never>((_,reject)=>{this.cancelStart=()=>{this.abandoned.add(token);reject(new RunnerError('Run stopped.'));};timer=setTimeout(()=>{this.abandoned.add(token);reject(new RunnerError('Debug adapter startup timed out. Check the debugger extension output and installation.',true));},30000);});
      let started:boolean;
      try{started=await Promise.race([vscode.debug.startDebugging(folder,{...configuration,__sakuraAtelierToken:token},{noDebug}),cancelled]);}finally{if(timer){clearTimeout(timer);}this.cancelStart=undefined;}
      if(!started){throw new RunnerError('The debug adapter did not start a session. See the Debug Console and adapter extension output.',true);}
    }catch(error){this.tokens.delete(token);await cleanup?.();throw error;}
    finally{this.launching=false;this.changed();}
  }
  async stop():Promise<void>{this.cancelStart?.();await Promise.allSettled([...this.owned.values()].map(s=>vscode.debug.stopDebugging(s)));for(let i=0;i<200&&this.owned.size;i++){await new Promise(resolve=>setTimeout(resolve,25));}if(this.owned.size){throw new RunnerError('The owned debugger is still stopping. Check the debug adapter output before restarting.');}}
  dispose():void{this.host?.signal.removeEventListener('abort',this.stopForHost);void this.stop();for(const s of this.subscriptions){s.dispose();}for(const cleanup of this.tokens.values()){if(cleanup){void cleanup().catch(error=>console.error('Sakura Atelier debug cleanup:',error));}}this.tokens.clear();this.owned.clear();this.ownerToken.clear();this.abandoned.clear();}
}
