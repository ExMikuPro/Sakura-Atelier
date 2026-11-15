import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fsHost } from './support/fsHost';
import { fakeHost } from './support/fakeHost';
import { nearestPlatformioRoot, readPlatformioProject } from '../src/embedded/platformio/project';
import { mergePlatformioConfigurations } from '../src/embedded/platformio/configurations';
import { validateFile } from '../src/configuration';
import { discoverEmbeddedTools } from '../src/embedded/toolchainDiscovery';
import { buildPlatformioPlan } from '../src/embedded/platformio/plans';
import { configFromJson, readConfig, readBoardDebug } from '../src/embedded/platformio/cli';
import type { AtelierController } from '../src/controller';
import type { AtelierConfiguration } from '../src/configuration';

async function fixture(work:(root:string)=>Promise<void>):Promise<void> {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sakura PIO 空格 $[]-'));
  try {
    await fs.mkdir(path.join(root,'nested','firmware','src'),{recursive:true});
    for (const file of ['platformio.ini','CMakeLists.txt','board.ioc','src/main.cpp','src/main.c','src/main.h']) await fs.writeFile(path.join(root,'nested','firmware',file),file==='platformio.ini'?'[env:a]\nplatform=espressif32\nboard=esp32dev\nframework=arduino\n[env:b]\nplatform=ststm32\nboard=nucleo_f401re':'');
    await work(root);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
}
test('nearest PlatformIO entry owns C/C++ and headers with CMake and IOC, nested and workspace boundaries',()=>fixture(async workspace=>{
  const root=path.join(workspace,'nested','firmware');
  for (const file of ['src/main.cpp','src/main.c','src/main.h','platformio.ini']) assert.equal(await nearestPlatformioRoot(path.join(root,file),workspace,fsHost),root);
  assert.equal(await nearestPlatformioRoot(path.join(root,'src/main.cpp'),path.join(workspace,'another'),fsHost),undefined);
  await fs.mkdir(path.join(root,'child'));
  await fs.writeFile(path.join(root,'child/platformio.ini'),'[env:child]');
  assert.equal(await nearestPlatformioRoot(path.join(root,'child/main.cpp'),workspace,fsHost),path.join(root,'child'));
}));
test('generated six configurations are portable, valid, idempotent, multi-project, and preserve custom edits',()=>fixture(async workspace=>{
  const project=(await readPlatformioProject(path.join(workspace,'nested/firmware'),fsHost))!;
  const first=mergePlatformioConfigurations({version:1,configurations:[]},[project],workspace);
  assert.equal(first.configurations.length,6); assert.equal(validateFile(first).configurations.length,6);
  first.configurations[0].name='用户编译';first.configurations[0].pioUploadPort='/dev/custom';
  assert.deepEqual(mergePlatformioConfigurations(first,[project],workspace),first);
  const two=mergePlatformioConfigurations(first,[{...project,root:path.join(workspace,'second')}],workspace);
  assert.equal(two.configurations.length,12);
  assert.ok(two.configurations.every(c=>c.target.startsWith('${workspaceFolder}')));
}));
test('Core discovery supports Homebrew prefix, official penv, virtual environments, and manual precedence',async()=>{
  for (const files of [['/custom/brew/bin/pio'],['/home/me/.platformio/penv/bin/platformio'],['/venv/bin/pio']]) {
    const host=fakeHost({platform:'darwin',files,env:{PATH:'/usr/bin',HOMEBREW_PREFIX:'/custom/brew',VIRTUAL_ENV:'/venv'}});
    assert.equal((await discoverEmbeddedTools(host)).platformio.selected?.path,files[0]);
  }
  const host=fakeHost({platform:'darwin',files:['/manual/pio','/bin/pio'],env:{PATH:'/bin'}});
  assert.equal((await discoverEmbeddedTools(host,{platformio:'/manual/pio'})).platformio.selected?.path,'/manual/pio');
});
test('official CLI config parsing resolves multiple environments and options using argv without a shell',async()=>{
  let calls=0;
  const ini=await readConfig(async(cmd,args,cwd)=>{calls++;assert.equal(cmd,'/path with spaces/pio');assert.equal(cwd,'/工程 $[]');assert.deepEqual(args,['project','config','-d',cwd,'--json-output']);return JSON.stringify([['platformio',[['default_envs',['b']]]],['env:a',[['platform','espressif32'],['framework',['arduino']]]],['env:b',[['platform','ststm32'],['debug_tool','stlink'],['monitor_speed',115200]]]]);},'/path with spaces/pio','/工程 $[]');
  assert.equal(calls,1);assert.equal(ini.sections.get('env:b')?.options.get('monitor_speed'),'115200');
});

type Workflow={runPlatformioConfiguration:(controller:AtelierController,action?:string,input?:AtelierConfiguration)=>Promise<void>};
async function harness(options:{failure?:string;trusted?:boolean;native?:boolean;debugTool?:string;extension?:boolean}={}) {
  const root='/workspace 空格/nested/firmware';
  const folder={uri:{scheme:'file',fsPath:'/workspace 空格',toString:()=>'/workspace 空格'},index:0,name:'workspace'};
  const project={root,ini:'platformio.ini',defaultEnvironments:['dev'],environments:[{name:'dev',platform:options.native?'native':'espressif32',board:'esp32dev',framework:'arduino',family:options.native?'native' as const:'other' as const,options:{debug_tool:options.debugTool || ''}}]};
  const document=mergePlatformioConfigurations({version:1,configurations:[]},[project],folder.uri.fsPath);
  const calls:{command:string;args:string[];cwd:string}[]=[], messages:string[]=[], states=new Map<string,unknown>();let discoveries=0,stops=0,debugs=0;
  const fake={tasks:{taskExecutions:[]},Uri:{file:(file:string)=>({scheme:'file',fsPath:file})},workspace:{isTrusted:options.trusted ?? true,getWorkspaceFolder:()=>folder,saveAll:async()=>true},ProgressLocation:{Notification:1},extensions:{getExtension:()=>options.extension===false?undefined:{}},commands:{executeCommand:async()=>{}},window:{activeTextEditor:{document:{uri:{scheme:'file',fsPath:root+'/src/main.cpp'}}},showQuickPick:async(items:{label:string}[])=>items[0],showInformationMessage:async(text:string)=>messages.push(text),withProgress:async(_opts:unknown,work:()=>Promise<void>)=>work()}};
  class FakeExecutor {
    cancelled=false;
    stop(){this.cancelled=true;stops++;}
    async exclusive(work:()=>Promise<void>){this.cancelled=false;await work();return true;}
    async run(plan:{steps:typeof calls}) {for(const step of plan.steps){calls.push(step);if(options.failure) throw new Error(options.failure);}}
  }
  const controller={context:{workspaceState:{get:(key:string)=>states.get(key),update:async(key:string,value:unknown)=>{states.set(key,value);}}},editorContext:async()=>({folder,root}),updateStatus(){},store:{read:async()=>({document,revision:'r'}),selection:()=>({kind:'auto'}),save:async(_folder:unknown,next:typeof document)=>{document.configurations=next.configurations;}},executor:new FakeExecutor(),debug:{start:async()=>{debugs++;}}} as unknown as AtelierController;
  const source=await fs.readFile(path.resolve(__dirname,'../src/embedded/platformio/workflow.js'),'utf8');const required=createRequire(path.resolve(__dirname,'../src/embedded/platformio/workflow.js'));const exports={} as Workflow;
  runInNewContext(source,{exports,process,console,require:(name:string)=>name==='vscode'?fake:name==='../../executor'?{TaskExecutor:FakeExecutor}:name==='../stm32/workflow'?{stm32Host:{readDir:async(dir:string)=>dir===root?['platformio.ini']:[]}}:name==='../toolsCommand'?{createToolRegistry:()=>({resolve:async()=>{discoveries++;return '/tools/pio';}})}:name==='./cli'?{readBoardDebug:async()=>({tools:options.debugTool?[options.debugTool]:[],onboard:[],defaultTool:undefined}),readConfig:async()=>configFromJson([['platformio',[['default_envs','dev']]],['env:dev',[['platform',project.environments[0].platform],['board','esp32dev'],['debug_tool',options.debugTool || '']]]]),listPorts:async()=>[{port:'/dev/tty.mock',description:'Mock'}],readMetadata:async()=>({progPath:root+'/firmware.elf',gdbPath:'/tools/gdb',compilerPath:'/tools/gcc'})}:required(name)});
  return {controller,document,calls,messages,run:(action:string)=>exports.runPlatformioConfiguration(controller,action),discoveries:()=>discoveries,stops:()=>stops,debugs:()=>debugs};
}
test('managed Build uses pio and selected project cwd; Run delegates build+upload once; failed build/upload never reports success',async()=>{
  const h=await harness();await h.run('build');assert.equal(h.calls.length,1);assert.equal(h.calls[0].command,'/tools/pio');assert.equal(h.calls[0].cwd,'/workspace 空格/nested/firmware');assert.ok(!h.calls[0].args.includes('upload'));
  h.calls.length=0;await h.run('upload');assert.equal(h.calls.length,1);assert.ok(h.calls[0].args.includes('upload'));assert.ok(h.messages.includes('上传成功，设备已启动'));
  for(const failure of ['build failed','upload failed']){const bad=await harness({failure});await assert.rejects(bad.run('upload'),new RegExp(failure));assert.equal(bad.messages.length,0);assert.equal(bad.calls.length,1);}
});
test('native Run invokes PlatformIO exec instead of uploading or executing ELF directly',async()=>{const h=await harness({native:true});await h.run('upload');assert.ok(h.calls[0].args.includes('exec'));assert.ok(!h.calls[0].args.includes('upload'));assert.equal(h.messages.length,0);});
test('unsupported debug or missing official extension reports actionable Chinese reason; supported debug uses real VS Code session interface',async()=>{
  for (const options of [{debugTool:''},{debugTool:'stlink',extension:false}]) {const h=await harness(options);await assert.rejects(h.run('debug'),/调试|探针/);assert.equal(h.debugs(),0);assert.equal(h.calls.length,0);}
  const h=await harness({debugTool:'esp-prog'});await h.run('debug');assert.equal(h.debugs(),1);assert.equal(h.calls[0].args[0],'debug');
});
test('untrusted workspace executes and discovers nothing',async()=>{const h=await harness({trusted:false});await assert.rejects(h.run('build'),/未受信任/);assert.equal(h.discoveries(),0);assert.equal(h.calls.length,0);});
test('monitor has a dedicated cancellable executor and failure shows Chinese port diagnostics',async()=>{
  const h=await harness();await h.run('monitor');assert.deepEqual(Array.from(h.calls[0].args).slice(0,2),['device','monitor']);h.controller.pioMonitor!.stop();assert.equal(h.stops(),1);assert.equal(h.controller.pioMonitor!.cancelled,true);
  const bad=await harness({failure:'busy'});await assert.rejects(bad.run('monitor'),/端口是否被占用/);
});
test('extra args cannot override project/environment or turn Build into a device write',()=>{
  const project={root:'/p',ini:'platformio.ini',defaultEnvironments:['dev'],environments:[{name:'dev',platform:'espressif32',board:'esp32dev',framework:'arduino',family:'other' as const}]};
  for(const arg of ['-t','--target=upload','-eother','--project-conf=/tmp/bad.ini','--project-dir=/tmp'])assert.ok(buildPlatformioPlan({operation:'build',project,env:'dev',pio:'/pio',extraArgs:[arg]}).blockers.length);
});

test('official board capabilities distinguish default onboard probes and unsupported boards',async()=>{
  const ready=await readBoardDebug(async(_cmd,args)=>{assert.deepEqual(args,['boards','--installed','--json-output','nucleo_f401re']);return JSON.stringify([{id:'nucleo_f401re',debug:{tools:{stlink:{default:true,onboard:true},jlink:{}}}}]);},'/pio','/p','nucleo_f401re');
  assert.deepEqual(ready,{tools:['stlink','jlink'],defaultTool:'stlink',onboard:['stlink']});
  assert.deepEqual(await readBoardDebug(async()=>JSON.stringify([{id:'uno'}]),'/pio','/p','uno'),{tools:[],onboard:[]});
  assert.equal(await readBoardDebug(async()=>'[]','/pio','/p','custom'),undefined);
});
test('nobuild upload, native exec, monitor filters and invalid baud are modeled explicitly',()=>{
  const project={root:'/p with spaces',ini:'platformio.ini',defaultEnvironments:['dev'],environments:[{name:'dev',platform:'espressif32',board:'esp32dev',framework:'arduino',family:'other' as const}]};
  const upload=buildPlatformioPlan({operation:'upload',project,env:'dev',pio:'/pio',buildBefore:false});
  assert.deepEqual(upload.steps[0].args,['run','-d',project.root,'-e','dev','-t','nobuild','-t','upload']);
  const monitor=buildPlatformioPlan({operation:'monitor',project,env:'dev',pio:'/pio',filters:['time','colorize'],baud:115200});
  assert.deepEqual(monitor.steps[0].args.slice(-6),['--baud','115200','--filter','time','--filter','colorize']);
  assert.ok(buildPlatformioPlan({operation:'monitor',project,env:'dev',pio:'/pio',baud:NaN}).blockers.length);
});
