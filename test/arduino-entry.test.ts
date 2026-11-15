import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { arduinoMain, ensureArduinoEntry } from '../src/embedded/platformio/arduino';
import { executeCreation, planCreation } from '../src/embedded/projects/creation';
import { builtinProjectTemplates } from '../src/embedded/projects/template';

test('Arduino entry contains Arduino.h and empty setup/loop, is created once, and preserves user code',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sakura Arduino 空格 '));
  try {
    const src=path.join(root,'src');
    assert.equal(await ensureArduinoEntry(src),true);
    assert.equal(await fs.readFile(path.join(src,'main.cpp'),'utf8'),arduinoMain);
    await fs.writeFile(path.join(src,'main.cpp'),'// user code');
    assert.equal(await ensureArduinoEntry(src),false);
    assert.equal(await fs.readFile(path.join(src,'main.cpp'),'utf8'),'// user code');
    await fs.rm(path.join(src,'main.cpp'));await fs.mkdir(path.join(src,'sketch'));
    await fs.writeFile(path.join(src,'sketch/blink.ino'),'void setup() {}');
    assert.equal(await ensureArduinoEntry(src),false);
    await assert.rejects(fs.access(path.join(src,'main.cpp')));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('Arduino project creation always seeds the entry after successful init and before opening, even with sampleCode disabled',async()=>{
  const board={kind:'pio-board' as const,id:'esp32dev',name:'ESP32',platform:'espressif32',frameworks:['arduino']};
  const plan=await planCreation({templateId:'platformio.board',name:'blink',parentDir:'/work',device:board,framework:'arduino',options:{sampleCode:false}}, {template:builtinProjectTemplates.find(t=>t.id==='platformio.board'),tools:{pio:'/pio'},boards:new Map([[board.id,board]]),fs:{exists:async()=>false,isDirectory:async()=>true},isStm32Project:async()=>false});
  assert.deepEqual(plan.blockers,[]);
  assert.deepEqual(plan.steps.map(s=>s.kind),['mkdir','run','arduino-entry','open']);
  const actions:string[]=[];
  await executeCreation(plan,{mkdir:async()=>{actions.push('mkdir');},run:async()=>{actions.push('init');},ensureArduinoEntry:async directory=>{assert.equal(directory,'/work/blink/src');actions.push('entry');}});
  assert.deepEqual(actions,['mkdir','init','entry']);
  const failed:string[]=[];
  await assert.rejects(executeCreation(plan,{mkdir:async()=>{},run:async()=>{throw new Error('init failed');},ensureArduinoEntry:async()=>{failed.push('entry');}}),/init failed/);
  assert.deepEqual(failed,[]);
});
