import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import { AtelierController } from '../../src/controller';
import { TaskExecutor } from '../../src/executor';
import { runPlatformioConfiguration, refreshPlatformioConfigurations } from '../../src/embedded/platformio/workflow';
import { embeddedToolsKey } from '../../src/embedded/toolRegistry';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function run():Promise<void> {
  const sandbox=process.env.SAKURA_PLATFORMIO_SANDBOX!;
  const extension=vscode.extensions.getExtension('ExMikuPro.sakura-atelier')!;
  await extension.activate();
  const folders=vscode.workspace.workspaceFolders!;
  for (const folder of folders) {
    for(let i=0;i<100;i++) {if(await fs.stat(path.join(folder.uri.fsPath,'.vscode/sakura-atelier.json')).catch(()=>undefined))break;await delay(150);}
    const saved=JSON.parse(await fs.readFile(path.join(folder.uri.fsPath,'.vscode/sakura-atelier.json'),'utf8'));
    assert.equal(saved.configurations.filter((c:{templateId:string})=>c.templateId==='platformio').length,6);
  }
  console.log('PASS real VS Code: nested multi-root automatic configurations, CMake/IOC coexistence');
  const root=path.join(folders[1].uri.fsPath,'deep/firmware');
  const doc=await vscode.workspace.openTextDocument(path.join(root,'src/main.cpp'));await vscode.window.showTextDocument(doc);
  // A separate controller exercises the public execution service against an actual mocked CLI process.
  const values=new Map<string,unknown>();
  const memento={get:<T>(key:string,fallback?:T)=>values.has(key)?values.get(key) as T:fallback,update:async(key:string,value:unknown)=>{values.set(key,value);},keys:()=>[...values.keys()],setKeysForSync:()=>{}};
  const cli=path.join(sandbox,'mock pio');
  await fs.writeFile(cli,`#!${process.env.SAKURA_TEST_NODE}\nconst fs=require('fs');const a=process.argv.slice(2);if(a[0]==='device' && a[1]==='list'){console.log('[]');}else if(a[0]==='--version'){console.log('PlatformIO Core, version mock');}else if(a[0]==='project'){console.log(JSON.stringify([['platformio',[['default_envs','dev']]],['env:dev',[['platform','espressif32'],['board','esp32dev']]]]));}else{fs.appendFileSync(${JSON.stringify(path.join(sandbox,'calls.jsonl'))},JSON.stringify({args:a,cwd:process.cwd(),pid:process.pid})+'\\n');if(a[0]==='device'){setInterval(()=>{},1000);}else{console.log('mock build successful');}}\n`,{mode:0o700});
  await memento.update(embeddedToolsKey,{platformio:cli});
  const context={globalState:memento,workspaceState:memento,subscriptions:[],secrets:{get:async()=>undefined}} as unknown as vscode.ExtensionContext;
  const executor=new TaskExecutor();const controller=new AtelierController(context,executor,async()=>{throw new Error('must not use legacy C++ runner');});
  try {
    const ctx=await controller.editorContext();assert.equal(ctx.root,root);
    await refreshPlatformioConfigurations(controller);
    await runPlatformioConfiguration(controller,'build');
    const call=JSON.parse((await fs.readFile(path.join(sandbox,'calls.jsonl'),'utf8')).trim());
    assert.equal(call.args[0],'run');assert.equal(await fs.realpath(call.cwd),await fs.realpath(root));assert.equal(call.args[call.args.indexOf('-e')+1],'dev');
    console.log('PASS real VS Code tasks + mock CLI: main.cpp keeps nearest project, environment and cwd');
    const monitoring=runPlatformioConfiguration(controller,'monitor');
    let monitorPid: number | undefined;
    for(let i=0;i<100;i++){
      const calls=(await fs.readFile(path.join(sandbox,'calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      monitorPid=calls.find(c=>c.args[0]==='device' && c.args[1]==='monitor')?.pid;
      if(monitorPid)break;
      await delay(50);
    }
    assert.ok(monitorPid,'mock serial process must actually start');
    assert.ok(controller.pioMonitor?.busy);
    await controller.stop();
    await Promise.race([monitoring,delay(5000).then(()=>{throw new Error('monitor did not stop');})]);
    assert.equal(controller.pioMonitor?.busy,false);
    let alive=true;
    for(let i=0;i<100;i++){try{process.kill(monitorPid!,0);}catch{alive=false;break;}await delay(50);}
    assert.equal(alive,false,'owned serial child process must exit');
    console.log('PASS real VS Code task lifecycle: serial monitor terminates on Stop (mock CLI, no hardware)');
    const current=(await controller.store.read(folders[1])).document;current.configurations[0].name='保留用户名称';
    await controller.store.save(folders[1],current,(await controller.store.read(folders[1])).revision);
    await refreshPlatformioConfigurations(controller);
    const refreshed=(await controller.store.read(folders[1])).document;
    assert.equal(refreshed.configurations.length,6);assert.equal(refreshed.configurations[0].name,'保留用户名称');
    console.log('PASS real VS Code persistence: no duplicates, user edits preserved');
    const emptyArduino=path.join(folders[0].uri.fsPath,'empty-arduino');
    await fs.mkdir(emptyArduino);
    await fs.writeFile(path.join(emptyArduino,'platformio.ini'),'[env:dev]\nplatform=espressif32\nboard=esp32dev\nframework=arduino\n');
    const entry=path.join(emptyArduino,'src/main.cpp');
    for(let i=0;i<100;i++){if(await fs.stat(entry).catch(()=>undefined))break;await delay(150);}
    assert.equal(await fs.readFile(entry,'utf8'),'#include <Arduino.h>\n\nvoid setup() {\n}\n\nvoid loop() {\n}\n');
    console.log('PASS real VS Code detection: empty Arduino project gets main.cpp with Arduino.h, setup and loop');
  } finally {controller.dispose();executor.dispose();}
}
