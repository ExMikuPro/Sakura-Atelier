import * as path from 'node:path';
import * as fs from 'node:fs/promises';
export type InitializationRun=(command:string,args:string[],cwd:string,env?:Record<string,string>)=>Promise<string>;
export const venvPython=(root:string)=>path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export async function ensurePythonVenv(root:string,python:string,manager:'pip'|'uv',run:InitializationRun,uv?:string):Promise<string>{
  const executable=venvPython(root);
  const exists=await fs.lstat(path.join(root,'.venv')).catch(()=>undefined);
  if(exists){
    try{await run(executable,['-c','import sys; assert sys.prefix != sys.base_prefix'],root);return executable;}
    catch{throw new Error('项目 .venv 已存在但不可用。请使用“Python：重新创建项目虚拟环境”修复；不会覆盖现有文件。');}
  }
  if(manager==='uv'){
    if(!uv)throw new Error('未找到 uv，请选择 pip 或先配置 uv。');
    await run(uv,['venv','--python',python,path.join(root,'.venv')],root);
  }else await run(python,['-m','venv',path.join(root,'.venv')],root);
  await run(executable,['-c','import sys; assert sys.prefix != sys.base_prefix'],root);
  return executable;
}
