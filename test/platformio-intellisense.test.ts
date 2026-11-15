import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {platformioSourceConfiguration,PlatformioCompletionLoader} from '../src/embedded/platformio/intellisense';
import type {Runner} from '../src/embedded/process';
const metadata={includes:['/sdk with spaces/cores/esp32','/sdk/libraries/Wire/src'],defines:['ARDUINO=10812','ARDUINO_ARCH_ESP32'],cxx_path:'/tool/xtensa-esp32-elf-g++',cc_path:'/tool/xtensa-esp32-elf-gcc',cxx_flags:['-std=gnu++2b','-mlongcalls','-include','sdkconfig.h'],cc_flags:['-std=gnu17']};
test('PlatformIO metadata supplies Arduino + library includes, defines, compiler, real language standard and forced headers',()=>{
  const cpp=platformioSourceConfiguration(metadata,'/project')!;
  assert.deepEqual(cpp.includePath,metadata.includes);assert.deepEqual(cpp.defines,metadata.defines);
  assert.equal(cpp.compilerPath,metadata.cxx_path);assert.equal(cpp.standard,'gnu++23');assert.deepEqual(cpp.forcedInclude,['/project/sdkconfig.h']);
  assert.equal(platformioSourceConfiguration(metadata,'/project',false)?.standard,'gnu17');
  assert.equal(platformioSourceConfiguration({...metadata,cxx_path:'/arm/bin/arm-none-eabi-g++'},'/project')?.intelliSenseMode,'gcc-arm');
  assert.equal(platformioSourceConfiguration({},'/project'),undefined);
  assert.deepEqual(platformioSourceConfiguration({...metadata,includes:{build:metadata.includes,toolchain:['/system/c++'] }},'/project')?.includePath,[...metadata.includes,'/system/c++']);
});
async function fixture(work:(root:string)=>Promise<void>):Promise<void>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'pio includes 空格 '));try{await fs.writeFile(path.join(root,'platformio.ini'),'[env:a]\n[env:b]\n');await work(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
const config=JSON.stringify([['platformio',[['default_envs','a'],['build_dir','custom build']]],['env:a',[['platform','espressif32']]],['env:b',[['platform','ststm32']]]]);
test('active environment alone is prepared with official CLI; custom build_dir cached metadata and reset are honored',()=>fixture(async root=>{
  const calls:string[][]=[];
  const run:Runner=async(_pio,args,cwd)=>{assert.equal(cwd,root);calls.push(args);return args[1]==='config'?config:JSON.stringify({a:metadata,b:{...metadata,defines:['BOARD_B']}});};
  const loader=new PlatformioCompletionLoader();
  assert.equal((await loader.load(root,'/pio',run,'b',true))?.cpp.defines[0],'BOARD_B');
  assert.deepEqual(calls[1],['project','metadata','-d',root,'-e','b','--json-output']);
  await fs.mkdir(path.join(root,'custom build/a'),{recursive:true});await fs.writeFile(path.join(root,'custom build/a/idedata.json'),JSON.stringify(metadata));
  calls.length=0;assert.equal((await loader.load(root,'/pio',run,undefined,false))?.environment,'a');assert.equal(calls.length,1);
  loader.reset();await loader.load(root,'/pio',run,'a',true);assert.equal(calls.length,3);
}));
test('inactive projects do not prepare/install SDKs, ambiguous environments never select a board silently, and failed preparation is not retried in a loop',()=>fixture(async root=>{
  let preparations=0;
  const run:Runner=async(_pio,args)=>{if(args[1]==='config')return config;if(++preparations)throw new Error('offline');return '';};
  const loader=new PlatformioCompletionLoader();
  assert.equal(await loader.load(root,'/pio',run,'a',false),undefined);assert.equal(preparations,0);
  await assert.rejects(loader.load(root,'/pio',run,'a',true),/offline/);
  assert.equal(await loader.load(root,'/pio',run,'a',true),undefined);assert.equal(preparations,1);
  const ambiguous:Runner=async()=>JSON.stringify([['env:a',[]],['env:b',[]]]);
  assert.equal(await loader.load(root,'/pio',ambiguous,undefined,true),undefined);
}));
test('malformed cached IDE data is regenerated instead of leaving Arduino includes unresolved',()=>fixture(async root=>{
  await fs.mkdir(path.join(root,'custom build/a'),{recursive:true});await fs.writeFile(path.join(root,'custom build/a/idedata.json'),'{}');
  let preparations=0;
  const run:Runner=async(_pio,args)=>{if(args[1]==='config')return config;preparations++;return JSON.stringify({a:{...metadata,includes:{build:metadata.includes,compatlib:[],toolchain:[]}}});};
  const completion=await new PlatformioCompletionLoader().load(root,'/pio',run,'a',true);
  assert.equal(preparations,1);assert.deepEqual(completion?.cpp.includePath,metadata.includes);
}));
