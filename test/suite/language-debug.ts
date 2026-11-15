import * as vscode from 'vscode';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {AtelierController} from '../../src/controller';
import {TaskExecutor} from '../../src/executor';
import {venvPython} from '../../src/languageProjects/pythonVenv';
import {adapters} from '../../src/adapters';
import {validateFile} from '../../src/configuration';
export async function run():Promise<void>{
  const root=process.env.SAKURA_TS_DEBUG_PROJECT!;
  await vscode.extensions.getExtension('ExMikuPro.sakura-atelier')!.activate();
  const memory=new Map<string,unknown>();
  const state={get:<T>(key:string,fallback:T)=>memory.get(key) as T ?? fallback,update:async(key:string,value:unknown)=>{memory.set(key,value);}};
  const executor=new TaskExecutor();const controller=new AtelierController({globalState:state,workspaceState:state,secrets:{get:async()=>undefined}} as unknown as vscode.ExtensionContext,executor,async()=>{});
  const pyRoot=path.join(root,'python-child'),pyFile=path.join(pyRoot,'src/main.py');
  const pyConfig=validateFile(JSON.parse(await fs.readFile(path.join(pyRoot,'.vscode/sakura-atelier.json'),'utf8'))).configurations[0];
  const pyFolder={uri:vscode.Uri.file(pyRoot),name:'python-child',index:0};
  try{
    const resolved=await controller.resolved(pyConfig,{folder:pyFolder,root:pyRoot,file:pyFile,language:'python',project:true},pyRoot,false);
    assert.equal(resolved.context.toolchain,venvPython(pyRoot));
    const debug=await adapters.get('python')!.buildDebugPlan(resolved.configuration,resolved.context,'debugpy');
    assert.equal(debug.configuration.python,venvPython(pyRoot));
    console.log('PASS real VS Code resolver: reopened Python project Run/Debug select its own .venv interpreter');
  }finally{controller.dispose();executor.dispose();}
  const folder=vscode.workspace.workspaceFolders![0];const uri=vscode.Uri.file(path.join(root,'src/index.ts'));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  const document=validateFile(JSON.parse(await fs.readFile(path.join(root,'.vscode/sakura-atelier.json'),'utf8')));
  const c={...document.configurations[0],cwd:root,target:uri.fsPath,terminal:false};
  const ctx={folder,root,file:uri.fsPath,cache:root,environment:{},toolchain:process.env.SAKURA_TS_NODE!};
  const prepared=await adapters.get('typescript')!.buildDebugPlan(c,ctx,'pwa-node');
  assert.equal(prepared.configuration.runtimeExecutable,ctx.toolchain);assert.equal(prepared.configuration.program,uri.fsPath);
  const breakpoint=new vscode.SourceBreakpoint(new vscode.Location(uri,new vscode.Position(1,0)));vscode.debug.addBreakpoints([breakpoint]);
  let active:vscode.DebugSession|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let resolveStopped:()=>void=()=>{};let rejectStopped:(error:Error)=>void=()=>{};
  const stopped=new Promise<void>((resolve,reject)=>{resolveStopped=resolve;rejectStopped=reject;timer=setTimeout(()=>reject(new Error('TypeScript source breakpoint did not stop')),45000);});
  const tracker=vscode.debug.registerDebugAdapterTrackerFactory('pwa-node',{createDebugAdapterTracker:session=>({onDidSendMessage:message=>{
    if(message.event==='stopped' && message.body.reason==='breakpoint'){
      active=session;
      void session.customRequest('stackTrace',{threadId:message.body.threadId,startFrame:0,levels:1}).then(stack=>{
        try{assert.equal(path.basename(stack.stackFrames[0].source.path),'index.ts');resolveStopped();}catch(error){rejectStopped(error as Error);}
      });
    }
  }})});
  try{
    assert.equal(await vscode.debug.startDebugging(folder,prepared.configuration),true);
    await stopped;console.log('PASS real Node debugger: TypeScript source breakpoint hit through tsx source maps');
  }finally{if(timer)clearTimeout(timer);if(active)await vscode.debug.stopDebugging(active);tracker.dispose();vscode.debug.removeBreakpoints([breakpoint]);}
}
