import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {commandArguments,compileConfiguration,cubeMxConfiguration} from '../src/embedded/stm32/intellisenseModel';
import {readStm32Project} from '../src/embedded/stm32/project';
import {fsHost} from './support/fsHost';
import type {Stm32IntelliSense} from '../src/embedded/stm32/intellisense';
import type {AtelierController} from '../src/controller';

async function fixture(work:(root:string)=>Promise<void>):Promise<void>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'STM32 补全 空格-'));
  try{
    await fs.mkdir(path.join(root,'cmake/stm32cubemx'),{recursive:true});
    await fs.writeFile(path.join(root,'board.ioc'),'Mcu.Name=STM32F302x8\n');
    await fs.writeFile(path.join(root,'CMakeLists.txt'),'project(board)\n# STM32');
    await fs.writeFile(path.join(root,'cmake/stm32cubemx/CMakeLists.txt'),'set(MX_Defines_Syms USE_HAL_DRIVER STM32F302x8 $<$<CONFIG:Debug>:DEBUG>)\nset(MX_Include_Dirs "${CMAKE_CURRENT_SOURCE_DIR}/../../Inc" "${CMAKE_CURRENT_SOURCE_DIR}/../../Drivers/CMSIS/Include")');
    await work(root);
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('compilation database parser preserves quoted paths, chip macros, CPU flags and forced includes without executing commands',()=>{
  assert.deepEqual(commandArguments('"/tool path/arm-gcc" -I"/sdk path/Inc" -DNAME=1 -c main.c'),['/tool path/arm-gcc','-I/sdk path/Inc','-DNAME=1','-c','main.c']);
  const c=compileConfiguration({directory:'/project space/build',file:'main.c',command:'"/tool path/gcc" -I"../../sdk path" -isystem /system -D STM32F407xx -DUSE_HAL_DRIVER -mcpu=cortex-m4 -mthumb -std=gnu11 -include ../config.h -o main.o -c main.c'},'/local/arm-gcc');
  assert.deepEqual(c.includePath,['/sdk path','/system']);assert.deepEqual(c.defines,['STM32F407xx','USE_HAL_DRIVER']);assert.deepEqual(c.compilerArgs,['-mcpu=cortex-m4','-mthumb']);assert.deepEqual(c.forcedInclude,['/project space/config.h']);assert.equal(c.compilerPath,'/local/arm-gcc');assert.equal(c.intelliSenseMode,'gcc-arm');assert.equal(c.standard,'gnu11');
});
test('CubeMX generated definitions and includes work before the first configure/build',()=>fixture(async root=>{
  const c=await cubeMxConfiguration((await readStm32Project(root,fsHost))!,fsHost,'/local/gcc');
  assert.deepEqual(c.defines,['USE_HAL_DRIVER','STM32F302x8','DEBUG']);assert.ok(c.includePath.includes(path.join(root,'Inc')));assert.ok(c.includePath.includes(path.join(root,'Drivers/CMSIS/Include')));
  assert.equal((await cubeMxConfiguration((await readStm32Project(root,fsHost))!,fsHost,undefined,true)).defines.includes('DEBUG'),false);
}));
async function provider(root:string,options:{trusted?:boolean;existingProvider?:string;database?:string|string[];manual?:boolean;enabled?:boolean}={}){
  const values=new Map<string,unknown>([['default.configurationProvider',options.existingProvider??''],['default.compileCommands',options.database??['']]]);const writes:[string,unknown][]=[];
  const state=new Map<string,unknown>();let registered=0;let ready=0;let discoveries=0;let disposed=0;
  const folder={uri:{scheme:'file',fsPath:root,toString:()=>root},name:'test',index:0};
  const subscription=()=>({dispose(){}});const watcher={dispose(){},onDidCreate:subscription,onDidChange:subscription,onDidDelete:subscription};
  const api={registerCustomConfigurationProvider:()=>{registered++;},notifyReady:()=>{ready++;},didChangeCustomConfiguration(){},didChangeCustomBrowseConfiguration(){},dispose(){disposed++;}};
  const settings={get:(key:string,fallback?:unknown)=>values.has(key)?values.get(key):fallback,inspect:()=>options.manual?{workspaceFolderValue:['/manual/include']}:undefined,update:async(key:string,value:unknown)=>{values.set(key,value);writes.push([key,value]);}};
  const fake={ConfigurationTarget:{WorkspaceFolder:3},RelativePattern:class{constructor(readonly folder:{uri:{fsPath:string}}){}},workspace:{isTrusted:options.trusted??true,workspaceFolders:[folder],createFileSystemWatcher:()=>watcher,onDidChangeWorkspaceFolders:subscription,onDidGrantWorkspaceTrust:subscription,onDidChangeConfiguration:subscription,findFiles:async(pattern:{folder:typeof folder})=>[{fsPath:path.join(pattern.folder.uri.fsPath,'board.ioc')}],getConfiguration:(section:string)=>section==='C_Cpp'?settings:{get:()=>options.enabled??true}},extensions:{onDidChange:subscription,getExtension:()=>({isActive:true,exports:{getApi:(version:number)=>{assert.equal(version,6);return api;}}})},window:{showInformationMessage:async()=>undefined}};
  const source=await fs.readFile(path.resolve(__dirname,'../src/embedded/stm32/intellisense.js'),'utf8');
  const required=createRequire(path.resolve(__dirname,'../src/embedded/stm32/intellisense.js'));const exports={} as {Stm32IntelliSense:typeof Stm32IntelliSense};
  runInNewContext(source,{exports,process,console,setTimeout,clearTimeout,require:(name:string)=>name==='vscode'?fake:name==='./workflow'?{stm32Host:fsHost}:name==='../toolsCommand'?{createToolRegistry:()=>({resolve:async()=>{discoveries++;return '/local/arm-gcc';}})}:required(name)});
  const controller={context:{workspaceState:{get:(key:string)=>state.get(key),update:async(key:string,value:unknown)=>{state.set(key,value);}},globalState:{get:(_key:string,fallback:unknown)=>fallback}},store:{read:async()=>({document:{version:1,configurations:[]}}),selection:()=>({kind:'auto'})}} as unknown as AtelierController;
  const service=new exports.Stm32IntelliSense(controller);
  return {service,fake,values,writes,counters:()=>({registered,ready,discoveries,disposed}),uri:(file:string)=>({scheme:'file',fsPath:file,toString:()=>file}) as import('vscode').Uri};
}
test('STM32 completion is enabled by default and supplies header configurations without persisting absolute compiler paths',()=>fixture(async root=>{
  const h=await provider(root);try{await h.service.refresh();assert.equal(h.counters().registered,1);assert.equal(h.counters().ready,1);assert.equal(h.values.get('default.configurationProvider'),'ExMikuPro.sakura-atelier');assert.equal(JSON.stringify(h.writes).includes('/local/'),false);
    const result=await h.service.provideConfigurations([h.uri(path.join(root,'Inc/main.h'))]);assert.ok(result[0].configuration.defines.includes('STM32F302x8'));assert.equal(result[0].configuration.compilerPath,'/local/arm-gcc');
    assert.equal(await h.service.canProvideConfiguration(h.uri(path.resolve(root,'../ordinary/main.c'))),false);
    await h.service.refresh();assert.equal(h.writes.length,1);
  }finally{h.service.dispose();}assert.equal(h.counters().disposed,1);
}));
test('a newly generated compilation database replaces fallback macros and configures its headers',()=>fixture(async root=>{
  const h=await provider(root);try{await h.service.refresh();await fs.mkdir(path.join(root,'build/Debug'),{recursive:true});await fs.writeFile(path.join(root,'build/Debug/compile_commands.json'),JSON.stringify([{directory:root,file:'Src/main.c',arguments:['arm-none-eabi-gcc','-DSTM32F302x8','-DFROM_DATABASE','-I','Inc','-mcpu=cortex-m4','-c','Src/main.c']}]));await h.service.refresh();const result=await h.service.provideConfigurations([h.uri(path.join(root,'Inc/main.h'))]);assert.ok(result[0].configuration.defines.includes('FROM_DATABASE'));assert.deepEqual([...result[0].configuration.compilerArgs],['-mcpu=cortex-m4']);
  }finally{h.service.dispose();}
}));
test('explicit CMake/STM32 providers, compile databases and hand-written C/C++ settings remain unchanged',()=>fixture(async root=>{
  for(const options of [{existingProvider:'ms-vscode.cmake-tools'},{database:'/custom/compile_commands.json'},{manual:true}]){
    const h=await provider(root,options);try{await h.service.refresh();assert.equal(h.writes.length,0);}finally{h.service.dispose();}
  }
  await fs.mkdir(path.join(root,'.vscode'));await fs.writeFile(path.join(root,'.vscode/c_cpp_properties.json'),'{}');const h=await provider(root);try{await h.service.refresh();assert.equal(h.writes.length,0);}finally{h.service.dispose();}
}));
test('untrusted workspaces and the off switch never activate/query a compiler or change C/C++ settings',()=>fixture(async root=>{
  for(const options of [{trusted:false},{enabled:false}]){const h=await provider(root,options);try{await h.service.refresh();assert.equal(h.counters().discoveries,0);assert.equal(h.counters().registered,0);assert.equal(h.writes.length,0);}finally{h.service.dispose();}}
}));

test('CubeMX generated CMake library is not detected as a second standalone STM32 project',()=>fixture(async root=>{
  assert.equal(await readStm32Project(path.join(root,'cmake/stm32cubemx'),fsHost),undefined);
}));

test('multiple workspace folders keep different STM32 chip macros isolated',()=>fixture(async first=>fixture(async second=>{
  const generated=path.join(second,'cmake/stm32cubemx/CMakeLists.txt');await fs.writeFile(generated,(await fs.readFile(generated,'utf8')).replaceAll('STM32F302x8','STM32H743xx'));
  const h=await provider(first);h.fake.workspace.workspaceFolders.push({uri:{scheme:'file',fsPath:second,toString:()=>second},name:'H743',index:1});
  try{await h.service.refresh();const configs=await h.service.provideConfigurations([h.uri(path.join(first,'Src/main.c')),h.uri(path.join(second,'Src/main.c'))]);assert.ok(configs[0].configuration.defines.includes('STM32F302x8'));assert.equal(configs[0].configuration.defines.includes('STM32H743xx'),false);assert.ok(configs[1].configuration.defines.includes('STM32H743xx'));assert.equal(configs[1].configuration.defines.includes('STM32F302x8'),false);}finally{h.service.dispose();}
})));
test('disabling automatic completion removes only the provider setting owned by Sakura Atelier',()=>fixture(async root=>{
  const options={enabled:true};const h=await provider(root,options);
  try{await h.service.refresh();assert.equal(h.values.get('default.configurationProvider'),'ExMikuPro.sakura-atelier');options.enabled=false;await h.service.refresh();assert.equal(h.values.get('default.configurationProvider'),undefined);assert.equal(await h.service.canProvideConfiguration(h.uri(path.join(root,'Src/main.c'))),false);}finally{h.service.dispose();}
}));
