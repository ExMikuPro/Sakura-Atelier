import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { AtelierConfiguration } from '../../configuration';
import type { AtelierController } from '../../controller';
import { RunnerError } from '../../model';
import { TaskExecutor } from '../../executor';
import { stm32Host } from '../stm32/workflow';
import { createToolRegistry } from '../toolsCommand';
import { nodeRunner } from '../process';
import { readConfig, readMetadata, listPorts, readBoardDebug } from './cli';
import { describeEnvironments, nearestPlatformioRoot, PlatformioProject, readPlatformioProject } from './project';
import { defaultEnvironments } from './ini';
import { buildPlatformioPlan, chooseEnvironment, platformioIdeExtension, PlatformioOperation } from './plans';
import { ensureArduinoEntry } from './arduino';
import { mergePlatformioConfigurations } from './configurations';

export async function loadResolvedProject(root: string, pio: string): Promise<PlatformioProject> {
  const ini=await readConfig(nodeRunner,pio,root);
  return {root,srcDir:path.resolve(root,ini.sections.get('platformio')?.options.get('src_dir') || 'src'),resolved:true,ini:'platformio.ini',environments:describeEnvironments(ini),defaultEnvironments:defaultEnvironments(ini)};
}
export async function activePlatformioRoot(): Promise<string | undefined> {
  const uri=vscode.window.activeTextEditor?.document.uri;
  const folder=uri && vscode.workspace.getWorkspaceFolder(uri);
  return uri?.scheme==='file' && folder ? nearestPlatformioRoot(uri.fsPath,folder.uri.fsPath,stm32Host) : undefined;
}
export async function refreshPlatformioConfigurations(controller: AtelierController): Promise<void> {
  if (!vscode.workspace.isTrusted) return;
  await controller.refreshProjects();
  const pio=controller.projects.some(p=>p.marker==='platformio.ini') ? await createToolRegistry(controller.context).resolve('platformio') : undefined;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const roots=controller.projects.filter(p=>p.folder.uri.toString()===folder.uri.toString() && p.marker==='platformio.ini');
    const projects=(await Promise.all(roots.map(p=>pio ? loadResolvedProject(p.root,pio).catch(()=>readPlatformioProject(p.root,stm32Host)) : readPlatformioProject(p.root,stm32Host)))).filter((p):p is PlatformioProject=>!!p);
    for (const project of projects) if (project.resolved && project.environments.length && project.environments.every(e=>e.framework.split(/[\s,]+/).includes('arduino'))) await ensureArduinoEntry(project.srcDir || path.join(project.root,'src'));
    const current=await controller.store.read(folder);
    const merged=mergePlatformioConfigurations(current.document,projects,folder.uri.fsPath);
    if (merged.configurations.length!==current.document.configurations.length) await controller.store.save(folder,merged,current.revision);
  }
  controller.updateStatus();
}
export async function platformioUiProjects(controller: AtelierController, folder: vscode.WorkspaceFolder): Promise<PlatformioProject[]> {
  if (!vscode.workspace.isTrusted) return [];
  const pio=await createToolRegistry(controller.context).resolve('platformio');
  if (!pio) return [];
  const roots=controller.projects.filter(p=>p.marker==='platformio.ini' && p.folder.uri.toString()===folder.uri.toString());
  return (await Promise.all(roots.map(p=>loadResolvedProject(p.root,pio).catch(()=>undefined)))).filter((p):p is PlatformioProject=>!!p);
}
export async function runPlatformioConfiguration(controller: AtelierController, action?: PlatformioOperation | 'selectEnvironment', input?: AtelierConfiguration): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new RunnerError('未受信任工作区禁止执行 PlatformIO 命令。');
  const ctx=await controller.editorContext();
  let root=input ? path.resolve(ctx.folder.uri.fsPath,input.target.replaceAll('${workspaceFolder}',ctx.folder.uri.fsPath)) : await activePlatformioRoot();
  if (!root) {
    await controller.refreshProjects();
    const roots=controller.projects.filter(p=>p.marker==='platformio.ini');
    root=roots.length===1 ? roots[0].root : (await vscode.window.showQuickPick(roots.map(p=>({label:path.basename(p.root),description:p.root,root:p.root})),{title:'选择 PlatformIO 工程'}))?.root;
  }
  if (!root) throw new RunnerError('未选择 PlatformIO 工程。');
  const folder=vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  if (!folder) throw new RunnerError('PlatformIO 工程必须位于当前工作区。');
  const document=(await controller.store.read(folder)).document;
  const selected=controller.store.selection(folder,root,document);
  const c=input ?? (selected.kind==='managed' ? document.configurations.find(c=>c.id===selected.id && c.templateId==='platformio' && path.resolve(folder.uri.fsPath,c.target.replaceAll('${workspaceFolder}',folder.uri.fsPath))===root) : undefined) ?? document.configurations.find(c=>c.templateId==='platformio' && c.pioAction===(action || 'upload') && path.resolve(folder.uri.fsPath,c.target.replaceAll('${workspaceFolder}',folder.uri.fsPath))===root);
  const pio=await createToolRegistry(controller.context).resolve('platformio');
  if (!pio) throw new RunnerError('未找到 PlatformIO Core。请在“嵌入式工具管理”中选择 pio / platformio 可执行文件。');
  let project: PlatformioProject;
  try { project=await loadResolvedProject(root,pio); } catch { throw new RunnerError('PlatformIO 无法解析工程配置。请检查 platformio.ini、extra_configs 和本机 Core；不会使用不完整配置运行。'); }
  if (!project.environments.length) throw new RunnerError('PlatformIO 工程没有定义可运行的 [env:名称] 环境。');
  const key=`sakuraAtelier.pio.env:${root}`;
  const choice=chooseEnvironment(project,c?.pioEnvironment || controller.context.workspaceState.get<string>(key));
  let env=choice.kind==='selected' && action!=='selectEnvironment' ? choice.env : undefined;
  if (!env) env=(await vscode.window.showQuickPick(project.environments.map(e=>({label:e.name,description:[e.board,e.platform,e.framework].filter(Boolean).join(' · ')})),{title:'请选择 PlatformIO Environment（开发板环境）'}))?.label;
  if (!env) return;
  await controller.context.workspaceState.update(key,env);
  // One environment belongs to the project; every generated action follows this choice.
  const configs=document.configurations.map(item=>item.templateId==='platformio' && path.resolve(folder.uri.fsPath,item.target.replaceAll('${workspaceFolder}',folder.uri.fsPath))===root ? {...item,pioEnvironment:env!} : item);
  if (configs.some((item,i)=>item.pioEnvironment!==document.configurations[i].pioEnvironment)) {
    const current=await controller.store.read(folder);
    await controller.store.save(folder,{...current.document,configurations:current.document.configurations.map(item=>configs.find(x=>x.id===item.id) ?? item)},current.revision);
  }
  controller.updateStatus();
  void import('../stm32/intellisense').then(service=>service.refreshStm32IntelliSense(controller)).catch(()=>{});
  if (action==='selectEnvironment') return;
  const operation=action ?? (c?.pioAction || 'upload') as PlatformioOperation;
  const environment=project.environments.find(e=>e.name===env)!;
  let metadata;
  if (operation==='debug') {
    if (!vscode.extensions.getExtension(platformioIdeExtension)) throw new RunnerError('请安装或启用 PlatformIO 官方扩展 platformio.platformio-ide，以启动断点、单步和变量调试。');
    const capabilities=environment.board ? await readBoardDebug(nodeRunner,pio,root,environment.board).catch(()=>undefined) : undefined;
    const tool=environment.options?.debug_tool || capabilities?.defaultTool;
    if (environment.family==='native' || !tool || (capabilities && !capabilities.tools.includes(tool))) throw new RunnerError('当前开发板未确认可用的调试工具。请先编译以安装对应平台，再检查开发板的调试支持、连接兼容探针并在 platformio.ini 设置 debug_tool；也可以选择已有 launch.json 调试配置。');
    metadata=await readMetadata(nodeRunner,pio,root,env);
  }
  let port=operation==='monitor' ? c?.pioMonitorPort : c?.pioUploadPort;
  if (operation==='monitor' && !port && !environment.options?.monitor_port) {
    const ports=await listPorts(nodeRunner,pio,root);
    if (ports.length) {
      port=(await vscode.window.showQuickPick(ports.map(p=>({label:p.port,description:p.description})),{title:'选择串口（当前扩展宿主）'}))?.label;
      if (!port) return;
    }
  }
  const plan=buildPlatformioPlan({operation,pio,project,env,port,baud:c?.pioMonitorSpeed ? Number(c.pioMonitorSpeed) : undefined,filters:c?.pioFilters.split(/[\s,]+/).filter(Boolean),uploadProtocol:c?.pioUploadProtocol,buildBefore:c?.pioBuildBefore!=='false',metadata,ideExtensionInstalled:!!vscode.extensions.getExtension(platformioIdeExtension),extraArgs:operation==='build' || operation==='upload' ? c?.buildArgs : [],debugTool:c?.pioDebugTool});
  if (plan.blockers.length) throw new RunnerError(plan.blockers.join('\n'));
  if (!await vscode.workspace.saveAll(false)) throw new RunnerError('保存失败，已取消执行。');
  if (vscode.tasks.taskExecutions.some(execution=>(execution.task.definition.type==='PlatformIO' || execution.task.source==='PlatformIO') && (typeof execution.task.scope!=='object' || execution.task.scope.uri.toString()===folder.uri.toString()))) throw new RunnerError('PlatformIO 官方扩展有任务正在执行。请先结束该任务，再使用 Sakura Atelier 操作。');
  if (operation==='monitor') {
    controller.pioMonitor ??= new TaskExecutor('Sakura Atelier — 串口监视');
    controller.pioMonitorRoot=root;
    await vscode.commands.executeCommand('setContext','sakuraAtelier.monitorRunning',true);
    try {
      if (!await controller.pioMonitor.exclusive(()=>controller.pioMonitor!.run({name:plan.label,steps:plan.steps},folder))) throw new RunnerError('串口监视已启动，请先停止监视。');
    } catch (error) {
      if (controller.pioMonitor.cancelled) return;
      throw new RunnerError(`串口监视失败：请检查端口是否被占用、设备连接和串口权限。${error instanceof Error ? error.message : ''}`);
    } finally { await vscode.commands.executeCommand('setContext','sakuraAtelier.monitorRunning',false); }
    return;
  }
  controller.pioMonitor?.stop();
  await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',true);
  let ran: boolean;
  try { ran=await controller.executor.exclusive(async()=>{
    if (!vscode.workspace.isTrusted) throw new RunnerError('工作区不受信任。');
    await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`PlatformIO — ${env}`},async()=>{
      let temporary: string | undefined;
      try {
        if (operation==='upload' && c?.pioUploadProtocol) {
          const ini=await readConfig(nodeRunner,pio,root!);
          const section=ini.sections.get('env:'+env);
          if (!section || /[\r\n]/.test(c.pioUploadProtocol)) throw new RunnerError('上传协议无效。');
          section.options.set('upload_protocol',c.pioUploadProtocol);
          // Fully resolved CLI output is serialized locally; the shared platformio.ini is untouched.
          ini.sections.get('platformio')?.options.delete('extra_configs');
          const text=[...ini.sections.values()].map(s=>'['+s.name+']\n'+[...s.options].map(([k,v])=>k+' = '+v.replaceAll('\n','\n  ')).join('\n')).join('\n\n');
          temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sakura-pio-'));
          const config=path.join(temporary,'platformio.ini');
          await fs.writeFile(config,text,{mode:0o600});
          for (const step of plan.steps) step.args.push('-c',config);
        }
        await controller.executor.run({name:plan.label,steps:plan.steps.map(s=>({...s,problemMatchers:['$gcc']}))},folder);
      } finally { if (temporary) await fs.rm(temporary,{recursive:true,force:true}); }
      if (plan.debug) await controller.debug.start({...folder,uri:vscode.Uri.file(root!),name:path.basename(root!)},plan.debug.configuration as vscode.DebugConfiguration);
      if (operation==='upload' && environment.family!=='native') void vscode.window.showInformationMessage('上传成功，设备已启动');
    });
  });
  } finally { await vscode.commands.executeCommand('setContext','sakuraAtelier.runRunning',controller.executor.busy); }
  if(ran) void import('../stm32/intellisense').then(service=>service.refreshStm32IntelliSense(controller,true)).catch(()=>{});
  if (!ran) throw new RunnerError('另一个 Sakura Atelier 操作正在执行。');
  if (operation==='upload' && c?.pioMonitorAfter==='true' && environment.family!=='native') await runPlatformioConfiguration(controller,'monitor',c);
}
