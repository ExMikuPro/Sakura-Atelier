import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {AtelierController} from '../controller';
import {hostToolchains} from '../environment/registryAccess';
import {ensurePythonVenv} from './pythonVenv';
import {initializationRunner} from './process';
export async function repairProjectVenv(controller:AtelierController):Promise<void>{
  if(!vscode.workspace.isTrusted)throw new Error('工作区未受信任，不能创建虚拟环境。');
  const ctx=await controller.editorContext();const root=ctx.root;
  const saved=controller.context.globalState.get<string>('atelier.createdProjectSdk:'+vscode.Uri.file(root).toString());
  const candidates=hostToolchains()?.snapshot().tools.filter(t=>t.language==='python'&&t.available&&!t.executable.includes(path.sep+'.venv'+path.sep)) || [];
  const sdk=saved && !saved.startsWith(path.join(root,'.venv')+path.sep) ? saved : candidates[0]?.executable;
  if(!sdk)throw new Error('未找到可用的基础 Python，请先在工具链管理中配置。');
  const env=path.join(root,'.venv');const exists=await fs.lstat(env).catch(()=>undefined);
  if(exists && await vscode.window.showWarningMessage('将把现有 .venv 重命名备份，并创建新的虚拟环境。现有安装包不会自动迁移，是否继续？',{modal:true},'备份并重新创建')!=='备份并重新创建')return;
  const output=vscode.window.createOutputChannel('Sakura Atelier — Python 虚拟环境');controller.context.subscriptions.push(output);output.show(true);
  await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'准备 Python 虚拟环境',cancellable:true},async(progress,token)=>{
    const abort=new AbortController();const listener=token.onCancellationRequested(()=>abort.abort());const run=initializationRunner(text=>output.append(text),abort.signal,message=>progress.report({message}));
    try{
      await run(sdk,['--version'],root);
      if(exists){const backup=env+'.backup-'+Date.now();await fs.rename(env,backup);output.appendLine('原环境已保留：'+backup);}
      const manager=await fs.stat(path.join(root,'uv.toml')).then(()=>true).catch(()=>false)?'uv':'pip';
      const uv=manager==='uv'?await (await import('../tools')).resolveTool('uv',root):undefined;
      const python=await ensurePythonVenv(root,sdk,manager,run,uv);
      if(manager==='uv')await run(uv!,['sync','--no-install-project'],root);
      await controller.python.synchronize(python,vscode.Uri.file(root));
      void vscode.window.showInformationMessage('项目 Python 虚拟环境已就绪。');
    }finally{listener.dispose();}
  });
}
