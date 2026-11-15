import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AtelierConfiguration } from '../../configuration';
import type { AtelierController } from '../../controller';
import { RunnerError } from '../../model';
import { BackendHost } from '../../adapterTypes';
import { createToolRegistry } from '../toolsCommand';
import { EmbeddedToolId } from '../toolchainDiscovery';
import { readStm32Project } from './project';
import { buildDirectory, buildStm32Plan, ToolPaths } from './plans';
import { cortexConfiguration, mergeStm32Configurations, openocdArguments, recommendedTarget, tclString } from './configurations';
import { OpenocdServer } from './server';
export const stm32Host: BackendHost = { readDir:dir=>fs.readdir(dir).catch(()=>[]), readText:file=>fs.readFile(file,'utf8').catch(()=>undefined) };
let output: vscode.OutputChannel | undefined;

export async function locateElf(directory: string, name: string, explicit = ''): Promise<string> {
  if (explicit) { if (path.extname(explicit).toLowerCase() !== '.elf' || !await fs.stat(explicit).then(s=>s.isFile()).catch(()=>false)) throw new RunnerError(`ELF 文件不存在：${explicit}`); return explicit; }
  const found: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    for (const entry of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])) {
      if (entry.isSymbolicLink()) continue;
      const file=path.join(dir,entry.name);
      if (entry.isFile() && /\.elf$/i.test(entry.name)) found.push(file);
      else if (entry.isDirectory() && depth < 5 && entry.name !== 'CMakeFiles') await visit(file,depth+1);
    }
  }
  await visit(directory,0);
  const exact=found.filter(f=>path.basename(f) === `${name}.elf`);
  if (exact.length === 1) return exact[0];
  if (found.length === 1) return found[0];
  throw new RunnerError(found.length ? '发现多个 ELF，请在构建设置中明确选择 ELF 路径。' : `构建未生成 ELF：${directory}`);
}
function expandProject(value: string, workspace: string, root: string): string { return value.replaceAll('${workspaceFolder}',workspace).replaceAll('${projectDir}',root); }

export async function runStm32Configuration(controller: AtelierController, folder: vscode.WorkspaceFolder, input: AtelierConfiguration, action: 'build'|'run'|'debug'): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new RunnerError('未受信任工作区禁止编译、烧录和调试。');
  if(action !== 'build' && controller.debug.running) throw new RunnerError('请先停止当前 Sakura Atelier 调试会话，再烧录或启动调试。');
  const workspace=folder.uri.fsPath;
  const localPaths=controller.context.globalState.get<Record<string,string>>('atelier.paths',{});
  const resolvePath=(value:string,root:string)=>expandProject(value.replace(/\$\{localPath:([^}]+)\}/g,(_match,id:string)=>{const saved=localPaths[folder.uri.toString()+':'+id];if(!saved)throw new RunnerError('本机路径已失效，请重新配置。');return saved;}),workspace,root);
  const root=path.resolve(workspace,resolvePath(input.target,workspace));
  const project=await readStm32Project(root,stm32Host);
  if (!project) throw new RunnerError('未找到 STM32 工程。');
  const c={...input};
  for(const field of ['stm32Elf','stm32Interface','stm32Target'] as const)c[field]=resolvePath(c[field],root);
  const registry=createToolRegistry(controller.context);
  const statuses=await registry.discover();
  const tools=Object.fromEntries(Object.entries(statuses).map(([id,status])=>[id,status.selected?.path])) as ToolPaths;
  for (const [field,id] of [['stm32Openocd','openocd'],['stm32Gdb','arm-gdb'],['stm32Gcc','arm-gcc']] as const) {
    if (c[field]) {
      const chosen=statuses[id].candidates.find(tool=>tool.path === c[field] || `embedded:${id}:${tool.path}` === c[field]);
      // UI stores stable local aliases; absolute paths are migrated by ConfigurationStore.
      const reference=c[field].match(/^\$\{localPath:([^}]+)\}$/)?.[1];
      const local=reference ? controller.context.globalState.get<Record<string,string>>('atelier.paths',{})[folder.uri.toString()+':'+reference] : undefined;
      const saved=c[field].match(/^embedded:([^:]+)$/)?.[1];
      const resolved=resolvePath(c[field],root);
      const executable=await fs.stat(resolved).then(s=>s.isFile()).catch(()=>false) ? resolved : undefined;
      tools[id as EmbeddedToolId]=local || chosen?.path || executable || (saved === id ? statuses[id].selected?.path : undefined);
      if (!tools[id]) throw new RunnerError('所选本机工具已不可用，请在嵌入式工具管理中重新选择。');
    }
  }
  if (action !== 'build') {
    if (!tools.openocd) {
      const choice=await vscode.window.showWarningMessage('未找到 OpenOCD。请配置本机路径，或通过 Homebrew 安装：brew install open-ocd', '通过 Homebrew 安装','管理工具');
      if (choice === '通过 Homebrew 安装') {
        const confirmed=await vscode.window.showWarningMessage('将在终端执行 brew install open-ocd。确认安装？',{modal:true},'安装');
        if (confirmed === '安装') {
          if (!vscode.workspace.isTrusted) return;
          const brew=process.platform === 'darwin' ? (await Promise.all(['/opt/homebrew/bin/brew','/usr/local/bin/brew'].map(async file=>await fs.stat(file).then(s=>s.isFile()).catch(()=>false) ? file : undefined))).find(Boolean) || 'brew' : 'brew';
          if (!await controller.executor.exclusive(()=>controller.executor.run({name:'安装 OpenOCD',steps:[{command:brew,args:['install','open-ocd'],cwd:workspace,label:'安装 OpenOCD',terminal:true}]},folder))) throw new RunnerError('另一个 Sakura Atelier 操作正在执行。');
        }
      } else if (choice) await vscode.commands.executeCommand('sakuraAtelier.embedded.manageTools');
      return;
    }
    if (!c.stm32Probe) {
      const probe=await vscode.window.showQuickPick([{label:'ST-LINK',id:'stlink',file:'interface/stlink.cfg'},{label:'J-Link',id:'jlink',file:'interface/jlink.cfg'},{label:'CMSIS-DAP',id:'cmsis-dap',file:'interface/cmsis-dap.cfg'}],{title:'请选择实际连接的调试探针'});
      if (!probe) return; c.stm32Probe=probe.id; c.stm32Interface ||= probe.file;
    }
    c.stm32Interface ||= ({stlink:'interface/stlink.cfg',jlink:'interface/jlink.cfg','cmsis-dap':'interface/cmsis-dap.cfg'} as Record<string,string>)[c.stm32Probe] || '';
    c.stm32Target ||= recommendedTarget(project.ioc?.info.mcu || '');
    if (!c.stm32Target) { c.stm32Target=await vscode.window.showInputBox({title:'无法确定芯片，请填写正确的 OpenOCD Target 配置',placeHolder:'target/stm32f4x.cfg'}) || ''; if (!c.stm32Target) return; }
    openocdArguments(c);
    if (action === 'debug' && (!tools['arm-gdb'] || !vscode.extensions.getExtension('marus25.cortex-debug'))) throw new RunnerError(!tools['arm-gdb'] ? '未找到 ARM GDB（arm-none-eabi-gdb），请在嵌入式工具管理中配置。' : '缺少 Cortex-Debug 调试器，请安装扩展 marus25.cortex-debug。');
  }
  const build=buildStm32Plan({operation:'build',project,tools,preset:c.stm32Preset || undefined,profile:c.profile === 'release' ? 'Release' : 'Debug',extraArgs:c.buildArgs});
  if ((action === 'build' || c.stm32BuildBefore !== 'false') && build.blockers.length) throw new RunnerError(build.blockers.join('\n'));
  const ran=await controller.executor.exclusive(async()=>{
    if (!vscode.workspace.isTrusted) throw new RunnerError('工作区不受信任。');
    if (!await vscode.workspace.saveAll(false)) throw new RunnerError('保存失败，已取消执行。');
    await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`STM32 — ${action === 'build' ? '编译' : action === 'run' ? '编译与烧录' : '启动调试'}`},async()=>{
      if (action === 'build' || c.stm32BuildBefore !== 'false') await controller.executor.run({name:'STM32 — 编译',steps:build.steps},folder);
      const directory=project.buildSystem === 'make' ? root : buildDirectory(project,c.profile === 'release' ? 'Release' : 'Debug',c.stm32Preset || undefined);
      const explicit=c.stm32Elf ? path.resolve(root,expandProject(c.stm32Elf,workspace,root)) : '';
      const elf=await locateElf(directory,project.projectName,explicit);
      if (action === 'build') { void vscode.window.showInformationMessage(`STM32 编译成功：${elf}`); return; }
      if (await vscode.window.showWarningMessage(`${c.stm32BuildBefore === 'false' ? '运行前自动编译已关闭。\n' : ''}即将${action === 'debug' && c.stm32Load === 'false' ? '调试（不下载）' : '下载固件'}：${elf}\n探针：${c.stm32Probe}，芯片配置：${c.stm32Target}`,{modal:true},action === 'run' ? '烧录并运行' : '开始调试') === undefined) return;
      if (!vscode.workspace.isTrusted || controller.executor.cancelled) throw new RunnerError('工作区不受信任或操作已停止，已取消。');
      const args=openocdArguments(c);
      if (action === 'run') {
        await controller.executor.run({name:'STM32 — 烧录并运行',steps:[{command:tools.openocd!,args:[...args,'-c',`program ${tclString(elf)} verify reset exit`],cwd:root,label:'烧录、校验并复位',terminal:true}]},folder);
        void vscode.window.showInformationMessage(`STM32 烧录成功，MCU 已独立运行：${elf}`);
      } else {
        output ??= vscode.window.createOutputChannel('Sakura Atelier — OpenOCD');
        if (!controller.context.subscriptions.includes(output)) controller.context.subscriptions.push(output);
        output.show(true);
        const server=new OpenocdServer();
        controller.stm32Cleanup=()=>server.stop();
        const disposable={dispose:()=>{void server.stop();}}; controller.context.subscriptions.push(disposable);
        try {
          await server.start(tools.openocd!,[...args,'-c',`gdb_port ${Number(c.stm32Port)}`,'-c','tcl_port disabled','-c','telnet_port disabled'],root,text=>output!.append(text),Number(c.stm32Port));
          if(controller.executor.cancelled || !vscode.workspace.isTrusted) throw new RunnerError('Run stopped.');
          await controller.debug.start(folder,cortexConfiguration(c,root,elf,tools['arm-gdb']!) as vscode.DebugConfiguration,false,async()=>{await server.stop();controller.stm32Cleanup=undefined;});
        } catch (error) { await server.stop(); controller.stm32Cleanup=undefined; throw error; }
      }
    });
  });
  if (!ran) throw new RunnerError('另一个 Sakura Atelier 操作正在执行。');
}

/** Scanning reads metadata only. Existing projects get a recommendation; CubeMX generation requests creation. */
export async function offerStm32Configurations(controller: AtelierController, generatedRoot?: string): Promise<void> {
  if (!vscode.workspace.isTrusted) return;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    const files=await vscode.workspace.findFiles(new vscode.RelativePattern(folder,'**/{*.ioc,CMakeLists.txt}'),'**/{node_modules,.git,build,.pio,Drivers}/**',500);
    const roots=new Set(files.map(file=>path.dirname(file.fsPath)));
    const projects=(await Promise.all([...roots].map(root=>readStm32Project(root,stm32Host)))).filter((p): p is NonNullable<typeof p>=>!!p);
    const current=await controller.store.read(folder);
    const merged=mergeStm32Configurations(current.document,projects,folder.uri.fsPath);
    if (merged.configurations.length === current.document.configurations.length) continue;
    const key='atelier.stm32.offered:'+folder.uri.toString();
    const preference=controller.context.workspaceState.get<string>(key);
    if (!generatedRoot && preference === 'declined') continue;
    if (!generatedRoot && preference !== 'accepted' && await vscode.window.showInformationMessage('检测到 STM32 工程，是否创建编译、运行和 OpenOCD 调试配置？','创建配置') !== '创建配置') {
      await controller.context.workspaceState.update(key,'declined'); continue;
    }
    await controller.context.workspaceState.update(key,'accepted');
    if (generatedRoot && !projects.some(p=>p.root === generatedRoot)) continue;
    await controller.store.save(folder,merged,current.revision);
    controller.updateStatus();
  }
}

export async function seedGeneratedConfigurations(context: vscode.ExtensionContext, root: string, standalone = false): Promise<void> {
  if (!vscode.workspace.isTrusted) return;
  const project=await readStm32Project(root,stm32Host); if (!project || project.buildSystem === 'cubemx') return;
  const folder=(!standalone ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root)) : undefined) ?? {uri:vscode.Uri.file(root),name:path.basename(root),index:0};
  const {ConfigurationStore}=await import('../../configurationStore');
  const store=new ConfigurationStore(context); const current=await store.read(folder);
  const merged=mergeStm32Configurations(current.document,[project],folder.uri.fsPath);
  if (merged.configurations.length !== current.document.configurations.length) await store.save(folder,merged,current.revision);
}
