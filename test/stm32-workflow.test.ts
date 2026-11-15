import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readStm32Project } from '../src/embedded/stm32/project';
import { fsHost } from './support/fsHost';
import { fakeHost } from './support/fakeHost';
import { discoverEmbeddedTools } from '../src/embedded/toolchainDiscovery';
import { EmbeddedToolRegistry } from '../src/embedded/toolRegistry';
import { cortexConfiguration, mergeStm32Configurations, openocdArguments, recommendedTarget, stm32Configurations, tclString } from '../src/embedded/stm32/configurations';
import { buildStm32Plan } from '../src/embedded/stm32/plans';
import { OpenocdServer } from '../src/embedded/stm32/server';
import { AtelierConfiguration, validateFile } from '../src/configuration';
import type { AtelierController } from '../src/controller';
import type { WorkspaceFolder } from 'vscode';

async function fixture(work:(root:string)=>Promise<void>):Promise<void> {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sakura STM32 空格 $[]-'));
  try {
    await fs.writeFile(path.join(root,'board.ioc'),'Mcu.Name=STM32F407ZETx\nProjectManager.ProjectName=board\n');
    await fs.writeFile(path.join(root,'CMakeLists.txt'),'project(board)\n# STM32');
    await work(root);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
}
test('STM32 presets honor include, inheritance and binaryDir; existing cache is recognized',()=>fixture(async root=>{
  await fs.writeFile(path.join(root,'base.json'),JSON.stringify({configurePresets:[{name:'base',hidden:true,binaryDir:'${sourceDir}/firmware out/${presetName}',cacheVariables:{CMAKE_BUILD_TYPE:'Debug'}}]}));
  await fs.writeFile(path.join(root,'CMakePresets.json'),JSON.stringify({include:['base.json'],configurePresets:[{name:'dev',inherits:'base'},{name:'prod',inherits:'base',cacheVariables:{CMAKE_BUILD_TYPE:'Release'}}]}));
  const project=(await readStm32Project(root,fsHost))!;
  assert.deepEqual(project.presets,['dev','prod']);
  const plan=buildStm32Plan({operation:'build',project,preset:'dev',tools:{cmake:'/cmake','arm-gcc':'/gcc'}});
  assert.deepEqual(plan.steps[0].args,['--preset','dev','-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']);
  assert.deepEqual(plan.steps[1].args,['--build',path.join(root,'firmware out/dev')]);
  assert.equal(stm32Configurations(project,root).find(c=>c.profile==='release')?.stm32Preset,'prod');
  await fs.mkdir(path.join(root,'build'));
  await fs.writeFile(path.join(root,'build/CMakeCache.txt'),`CMAKE_HOME_DIRECTORY:INTERNAL=${root}\nCMAKE_BUILD_TYPE:STRING=Debug`);
  const existing=(await readStm32Project(root,fsHost))!;
  assert.equal(buildStm32Plan({operation:'build',project:existing,tools:{cmake:'/cmake','arm-gcc':'/gcc',ninja:'/ninja'}}).steps[0].args.includes('Ninja'),false);
}));
test('STM32 configuration creation is portable, multi-project and idempotent; edits survive rescans',()=>fixture(async root=>{
  const project=(await readStm32Project(root,fsHost))!;
  const first=mergeStm32Configurations({version:1,configurations:[]},[project],root);
  assert.equal(first.configurations.length,3);
  assert.equal(first.configurations[0].target,'${workspaceFolder}');
  first.configurations[1].name='我的固件';
  const second=mergeStm32Configurations(first,[project],root);
  assert.deepEqual(second,first); assert.equal(validateFile(second).configurations.length,3);
  assert.equal(stm32Configurations({...project,root:path.join(root,'another')},root)[0].id === first.configurations[0].id,false);
  assert.equal(first.configurations[1].stm32Probe,'');
}));
test('OpenOCD family recommendations distinguish F4, H7, G0, L4 and unknown chips',()=>{
  for(const [part,target] of [['STM32F407ZET6','stm32f4x'],['STM32H743ZIT6','stm32h7x'],['STM32G071RBT6','stm32g0x'],['STM32L476RGT6','stm32l4x']]) assert.equal(recommendedTarget(part),`target/${target}.cfg`);
  for(const part of ['unknown','STM32H7S3L8','STM32WBA55']) assert.equal(recommendedTarget(part),'');
});
test('OpenOCD and ARM GDB discovery prefers Homebrew on macOS and persists only locally',async()=>{
  const host=fakeHost({platform:'darwin',files:['/opt/homebrew/bin/openocd','/opt/homebrew/bin/arm-none-eabi-gcc','/opt/homebrew/bin/arm-none-eabi-gdb','/usr/bin/openocd'],env:{PATH:'/usr/bin'}});
  const statuses=await discoverEmbeddedTools(host);
  assert.equal(statuses.openocd.selected?.path,'/opt/homebrew/bin/openocd');
  assert.equal(statuses['arm-gdb'].selected?.path,'/opt/homebrew/bin/arm-none-eabi-gdb');
  const state=new Map<string,unknown>();
  const registry=new EmbeddedToolRegistry({get:<T>(key:string,fallback:T)=>state.get(key) as T ?? fallback,update:async(key,value)=>{state.set(key,value);}},host);
  await registry.discover(); assert.ok(state.has('atelier.embeddedTools.discovered'));
  await registry.locate('openocd','/usr/bin/openocd'); assert.equal(await registry.resolve('openocd'),'/usr/bin/openocd');
});

interface WorkflowModule {runStm32Configuration: (controller:AtelierController,folder:WorkspaceFolder,c:AtelierConfiguration,action:'build'|'run'|'debug')=>Promise<void>}
async function harness(root:string, options:{buildFails?:boolean;flashFails?:boolean;missing?:string;trusted?:boolean}={}) {
  const messages:string[]=[]; const calls:string[]=[]; let starts=0;
  const folder={uri:{fsPath:root,toString:()=>root},name:'board',index:0} as WorkspaceFolder;
  const fake={workspace:{isTrusted:options.trusted ?? true,saveAll:async()=>true},ProgressLocation:{Notification:1},extensions:{getExtension:()=>options.missing==='cortex'?undefined:{}},window:{withProgress:async(_opts:unknown,work:()=>Promise<void>)=>work(),showWarningMessage:async(message:string,_opts:unknown,button:string)=>{messages.push(message);return options.missing==='openocd'?undefined:button;},showInformationMessage:async(message:string)=>{messages.push(message);}}};
  const tools=Object.fromEntries(['cmake','arm-gcc','arm-gdb','openocd'].filter(id=>id!==options.missing).map(id=>[id,{selected:{path:`/tools/${id}`},candidates:[]} ]));
  const source=await fs.readFile(path.resolve(__dirname,'../src/embedded/stm32/workflow.js'),'utf8');
  const required=createRequire(path.resolve(__dirname,'../src/embedded/stm32/workflow.js')); const exports={} as WorkflowModule;
  runInNewContext(source,{exports,process,console,setTimeout,clearTimeout,require:(name:string)=>name==='vscode'?fake:name==='../toolsCommand'?{createToolRegistry:()=>({discover:async()=>tools})}:required(name)});
  const controller={context:{globalState:{get:(_key:string,fallback:unknown)=>fallback}},executor:{exclusive:async(work:()=>Promise<void>)=>{await work();return true;},run:async(plan:{steps:{command:string}[]})=>{for(const step of plan.steps){calls.push(step.command);if(options.buildFails&&step.command==='/tools/cmake')throw new Error('build failed');if(options.flashFails&&step.command==='/tools/openocd')throw new Error('flash failed');}}},debug:{start:async()=>{starts++;}}} as unknown as AtelierController;
  const c=stm32Configurations((await readStm32Project(root,fsHost))!,root)[1];
  Object.assign(c,{stm32Probe:'stlink',stm32Interface:'interface/stlink.cfg'});
  await fs.mkdir(path.join(root,'build/Debug'),{recursive:true}); await fs.writeFile(path.join(root,'build/Debug/board.elf'),'fake ELF (no hardware)');
  return {run:(action:'build'|'run'|'debug')=>exports.runStm32Configuration(controller,folder,c,action),c,calls,messages,starts:()=>starts};
}
test('workflow contract: failed build aborts before flashing even when an old ELF exists',()=>fixture(async root=>{
  const h=await harness(root,{buildFails:true});await assert.rejects(h.run('run'),/build failed/);assert.deepEqual(h.calls,['/tools/cmake']);assert.equal(h.starts(),0);
}));
test('workflow contract: failed flash never reports run success or starts debugging',()=>fixture(async root=>{
  const h=await harness(root,{flashFails:true});await assert.rejects(h.run('run'),/flash failed/);assert.equal(h.messages.some(m=>m.includes('烧录成功')),false);assert.equal(h.starts(),0);
}));
test('workflow contract: Build only compiles and locates ELF; Run builds then flashes without a debug session',()=>fixture(async root=>{
  const h=await harness(root);await h.run('build');assert.equal(h.calls.includes('/tools/openocd'),false);assert.ok(h.messages.some(m=>m.includes('board.elf')));
  h.calls.length=0;await h.run('run');assert.deepEqual(h.calls,['/tools/cmake','/tools/cmake','/tools/openocd']);assert.equal(h.starts(),0);
}));
test('workflow contract: disabled automatic build explicitly names the downloaded ELF',()=>fixture(async root=>{
  const h=await harness(root);h.c.stm32BuildBefore='false';await h.run('run');assert.deepEqual(h.calls,['/tools/openocd']);assert.ok(h.messages.some(m=>m.includes('自动编译已关闭')&&m.includes('board.elf')));
}));
test('missing Cortex-Debug or ARM GDB produces Chinese diagnostics before execution',()=>fixture(async root=>{
  for(const [missing,message] of [['cortex',/缺少 Cortex-Debug/],['arm-gdb',/未找到 ARM GDB/]] as const){const h=await harness(root,{missing});await assert.rejects(h.run('debug'),message);assert.deepEqual(h.calls,[]);}
}));
test('untrusted STM32 workflow never discovers, builds, flashes or debugs',()=>fixture(async root=>{
  const h=await harness(root,{trusted:false});await assert.rejects(h.run('run'),/未受信任/);assert.deepEqual(h.calls,[]);
}));
test('OpenOCD Tcl paths are quoted, and debug launch honors flash and run-to-main options',()=>fixture(async root=>{
  const c=stm32Configurations((await readStm32Project(root,fsHost))!,root)[1];
  assert.throws(()=>openocdArguments(c),/请选择/);
  Object.assign(c,{stm32Probe:'stlink',stm32Interface:'interface/stlink.cfg'});
  assert.ok(openocdArguments(c).includes('transport select hla_swd'));
  assert.equal(tclString('/a b/$x[cmd]".elf'),'"/a b/\\$x\\[cmd\\]\\".elf"');
  const launch=cortexConfiguration(c,root,'/a.elf','/arm/gdb');assert.equal(launch.gdbTarget,'localhost:3333');assert.equal(launch.runToEntryPoint,'main');
  c.stm32Load='false';c.stm32Main='false';const noLoad=cortexConfiguration(c,root,'/a.elf','/arm/gdb');assert.equal((noLoad.overrideLaunchCommands as string[]).includes('load'),false);assert.equal(noLoad.runToEntryPoint,undefined);
}));
test('OpenOCD process lifecycle (real child process, simulated server; no hardware): readiness, cleanup and startup failure',async()=>{
  const server=new OpenocdServer();
  await server.start(process.execPath,['-e',"console.error('Listening on port 3333 for gdb connections');setInterval(()=>{},1000)"],os.tmpdir(),()=>{},3333);
  await server.stop();await server.stop();
  const failure=new OpenocdServer();await assert.rejects(failure.start(process.execPath,['-e','process.exit(1)'],os.tmpdir(),()=>{},3333),/启动失败/);await failure.stop();
  const missing=new OpenocdServer();await assert.rejects(missing.start('/nonexistent-openocd',[],os.tmpdir(),()=>{},3333),/ENOENT/);await missing.stop();
});
test('STM32 toolbar is context gated; .ioc association is optional and extension identity stays unchanged',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.resolve(__dirname,'../../package.json'),'utf8'));
  assert.equal(manifest.version,'0.1.0');assert.equal(manifest.publisher+'.'+manifest.name,'ExMikuPro.sakura-atelier');
  const build=manifest.contributes.commands.find((c:{command:string})=>c.command==='sakuraAtelier.embedded.stm32.build');assert.equal(build.icon,'$(build)');
  for(const menu of manifest.contributes.menus['editor/title'].filter((m:{command:string})=>m.command.startsWith('sakuraAtelier.embedded.stm32.')))assert.equal(menu.when,'sakuraAtelier.stm32Editor');
  assert.equal(manifest.contributes.customEditors.find((e:{viewType:string})=>e.viewType==='sakuraAtelier.iocViewer').priority,'option');
});

test('workspace scan creates configurations once per workspace, preserves edits, and never executes tools',()=>fixture(async first=>fixture(async second=>{
  const folders=[first,second].map(root=>({uri:{scheme:'file',fsPath:root,toString:()=>root},name:path.basename(root),index:0}));
  const documents=new Map<string,ReturnType<typeof mergeStm32Configurations>>(); let saves=0;let prompts=0;
  const state=new Map<string,unknown>();
  const fake={workspace:{isTrusted:true,workspaceFolders:folders,findFiles:async(pattern:{folder:typeof folders[number]})=>[{fsPath:path.join(pattern.folder.uri.fsPath,'board.ioc')}]},RelativePattern:class{constructor(readonly folder:unknown){}},window:{showInformationMessage:async()=>{prompts++;return '创建配置';}}};
  const controller={context:{workspaceState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>{state.set(key,value);}}},store:{read:async(folder:typeof folders[number])=>({document:documents.get(folder.uri.fsPath) ?? {version:1,configurations:[]},revision:'r'}),save:async(folder:typeof folders[number],doc:ReturnType<typeof mergeStm32Configurations>)=>{documents.set(folder.uri.fsPath,doc);saves++;}},updateStatus(){}};
  const source=await fs.readFile(path.resolve(__dirname,'../src/embedded/stm32/workflow.js'),'utf8');
  const required=createRequire(path.resolve(__dirname,'../src/embedded/stm32/workflow.js'));const exports={} as {offerStm32Configurations:(controller:unknown)=>Promise<void>};
  runInNewContext(source,{exports,process,console,require:(name:string)=>name==='vscode'?fake:name==='../toolsCommand'?{createToolRegistry:()=>{throw new Error('scanning must not run tools');}}:required(name)});
  await exports.offerStm32Configurations(controller); assert.equal(saves,2);assert.equal(prompts,2);
  documents.get(first)!.configurations[1].name='用户修改';
  await exports.offerStm32Configurations(controller);assert.equal(saves,2);assert.equal(documents.get(first)!.configurations[1].name,'用户修改');
})));
test('Cortex-Debug session ownership cleans its server and leaves foreign STM32 sessions alone (mock contract)',async()=>{
  let started:(session:unknown)=>void=()=>{};let ended:(session:unknown)=>void=()=>{};const stopped:string[]=[];let cleanups=0;
  const fake={workspace:{isTrusted:true},extensions:{all:[{id:'marus25.cortex-debug',packageJSON:{contributes:{debuggers:[{type:'cortex-debug'}]}}}]},debug:{onDidStartDebugSession:(cb:typeof started)=>{started=cb;return {dispose(){}};},onDidTerminateDebugSession:(cb:typeof ended)=>{ended=cb;return {dispose(){}};},startDebugging:async(_folder:unknown,configuration:unknown)=>{started({id:'ours',configuration});return true;},stopDebugging:async(session:{id:string})=>{stopped.push(session.id);ended(session);}}};
  const source=await fs.readFile(path.resolve(__dirname,'../src/debugService.js'),'utf8'); const required=createRequire(path.resolve(__dirname,'../src/debugService.js'));
  const exports={} as {DebugService:new()=>{start(folder:unknown,config:unknown,noDebug:boolean,cleanup:()=>Promise<void>):Promise<void>;stop():Promise<void>;dispose():void}};
  runInNewContext(source,{exports,process,console,setTimeout,clearTimeout,require:(name:string)=>name==='vscode'?fake:name==='./environment/registryAccess'?{hostToolchains:()=>undefined}:required(name)});
  const service=new exports.DebugService();started({id:'other-extension',configuration:{type:'cortex-debug'}});
  await service.start({}, {name:'STM32',type:'cortex-debug',request:'launch'},false,async()=>{cleanups++;});
  await service.stop();assert.deepEqual(stopped,['ours']);assert.equal(cleanups,1);service.dispose();
});
test('OpenOCD startup cancellation terminates only its child (simulated server; no hardware)',async()=>{
  const server=new OpenocdServer();
  const starting=server.start(process.execPath,['-e','setInterval(()=>{},1000)'],os.tmpdir(),()=>{},3333);
  const rejected=assert.rejects(starting,/启动失败/);
  await server.stop();await rejected;
});

test('missing OpenOCD shows a Chinese Homebrew entry and does not install in the background',()=>fixture(async root=>{
  const h=await harness(root,{missing:'openocd'});await h.run('run');assert.ok(h.messages.some(m=>m.includes('未找到 OpenOCD')&&m.includes('brew install open-ocd')));assert.deepEqual(h.calls,[]);
}));
