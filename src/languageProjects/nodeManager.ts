import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {resolveTool} from '../tools';
import {Step} from '../model';
/** Use the selected Node for the manager and its lifecycle scripts; never change the system PATH. */
export async function nodeManagerStep(node:string,manager:'npm'|'pnpm',args:string[],cwd:string):Promise<Step> {
  const env={PATH:path.dirname(node)+path.delimiter+(process.env.PATH || '')};
  const candidates=manager==='npm'?[path.resolve(path.dirname(node),'../lib/node_modules/npm/bin/npm-cli.js'),path.join(path.dirname(node),'node_modules/npm/bin/npm-cli.js')]:[];
  let cli=await Promise.any(candidates.map(async file=>{await fs.access(file);return file;})).catch(()=>undefined);
  cli ??= await fs.realpath(await resolveTool(manager,cwd,{...process.env,...env}));
  const handle=await fs.open(cli,'r');let header:string;
  try{const bytes=Buffer.alloc(512);const {bytesRead}=await handle.read(bytes,0,512,0);header=bytes.subarray(0,bytesRead).toString('utf8');}finally{await handle.close();}
  const script=/\.[cm]?js$/.test(cli)||/^#![^\n]*\bnode\b/.test(header);
  return {command:script?node:cli,args:script?[cli,...args]:args,cwd,env,label:`${manager} ${args[0]}`,terminal:true};
}
