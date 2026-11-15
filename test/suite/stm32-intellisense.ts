import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function run():Promise<void>{
  const root=process.env.SAKURA_STM32_COMPLETION_WORKSPACE!;
  await vscode.extensions.getExtension('ExMikuPro.sakura-atelier')!.activate();
  const uri=vscode.Uri.file(path.join(root,'Src/main.c'));
  const document=await vscode.workspace.openTextDocument(uri);await vscode.window.showTextDocument(document);
  for(let i=0;i<100 && vscode.workspace.getConfiguration('C_Cpp',uri).get('default.configurationProvider')!=='ExMikuPro.sakura-atelier';i++)await delay(200);
  assert.equal(vscode.workspace.getConfiguration('C_Cpp',uri).get('default.configurationProvider'),'ExMikuPro.sakura-atelier');
  const position=new vscode.Position(2,'void test(void) { GPIO_InitTypeDef gpio; gpio.'.length);
  const complete=async(label:string)=>{
    for(let i=0;i<120;i++){
      const result=await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider',uri,position,'.');
      if(result?.items.some(item=>(typeof item.label==='string'?item.label:item.label.label)===label))return;
      await delay(250);
    }
    throw new Error('真实 C/C++ 补全未返回成员：'+label);
  };
  await complete('Mode');console.log('PASS real cpptools: STM32 member completion before build');
  await fs.mkdir(path.join(root,'build/Debug'),{recursive:true});
  await fs.writeFile(path.join(root,'build/Debug/compile_commands.json'),JSON.stringify([{directory:root,file:'Src/main.c',arguments:['arm-none-eabi-gcc','-I',path.join(root,'Inc'),'-DUSE_HAL_DRIVER','-DSTM32F302x8','-DDATABASE_ONLY','-mcpu=cortex-m4','-mthumb','-c','Src/main.c']}]));
  await complete('DatabaseMember');console.log('PASS real cpptools: database refresh enables conditional member');
  const settings=await fs.readFile(path.join(root,'.vscode/settings.json'),'utf8');
  assert.ok(!settings.includes('/opt/homebrew'));console.log('PASS no absolute machine compiler path in project settings');
}
