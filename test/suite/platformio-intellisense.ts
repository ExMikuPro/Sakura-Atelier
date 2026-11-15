import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function run():Promise<void>{
  const root=process.env.SAKURA_PIO_COMPLETION_WORKSPACE!;
  await vscode.extensions.getExtension('ExMikuPro.sakura-atelier')!.activate();
  const uri=vscode.Uri.file(path.join(root,'src/main.cpp'));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  for(let i=0;i<120;i++){
    const result=await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider',uri,new vscode.Position(1,'void setup(){ Serial.'.length),'.');
    if(result?.items.some(item=>(typeof item.label==='string'?item.label:item.label.label)==='begin'))break;
    if(i===119)throw new Error('Arduino Serial.begin completion not found');
    await delay(500);
  }
  console.log('PASS real cpptools + real PlatformIO metadata: Arduino Serial.begin completion before building');
  const locations=await vscode.commands.executeCommand<(vscode.Location|vscode.LocationLink)[]>('vscode.executeDefinitionProvider',uri,new vscode.Position(0,12));
  assert.ok(locations?.some(item=>('targetUri' in item?item.targetUri:item.uri).fsPath.endsWith('Arduino.h')),'Arduino.h resolves to SDK header');
  console.log('PASS real cpptools: #include <Arduino.h> resolves to installed SDK');
  const diagnostics=vscode.languages.getDiagnostics(uri);
  assert.ok(!diagnostics.some(d=>/1696/.test(String(typeof d.code==='object'?d.code.value:d.code)) || /cannot open source file|检测到 #include/.test(d.message)));
  const settings=await fs.readFile(path.join(root,'.vscode/settings.json'),'utf8');
  assert.ok(!settings.includes('.platformio/packages'));assert.ok(!settings.includes('/opt/homebrew'));
  console.log('PASS provider uses in-memory SDK paths; project settings contain no machine toolchain path');
}
